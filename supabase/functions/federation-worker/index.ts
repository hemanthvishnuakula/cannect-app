import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Federation Worker Edge Function
 * 
 * Processes the federation_queue and pushes records to the PDS (cannect.space).
 * The PDS then syncs to the Bluesky relay (bsky.network) automatically.
 * 
 * Flow:
 * 1. Fetch pending queue items
 * 2. For each item, get user's PDS session
 * 3. Push record to PDS using com.atproto.repo.createRecord
 * 4. Mark as synced and store the returned CID
 */

const PDS_URL = "https://cannect.space";
const MAX_BATCH_SIZE = 10;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QueueItem {
  id: string;
  record_type: string;
  record_id: string;
  user_did: string;
  collection: string;
  rkey: string;
  at_uri: string;
  record_data: Record<string, any> | null;
  operation: 'create' | 'update' | 'delete';
  status: string;
  attempts: number;
}

interface PdsSession {
  access_jwt: string;
  refresh_jwt: string;
  user_id: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  console.log("[federation-worker] Starting processing...");
  console.log("[federation-worker] Service key starts with:", supabaseServiceKey?.substring(0, 20) + "...");

  try {
    // Fetch pending items from queue, ordered by creation time
    const { data: queueItems, error: fetchError } = await supabase
      .from("federation_queue")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(MAX_BATCH_SIZE);

    console.log("[federation-worker] Queue fetch result:", { count: queueItems?.length, error: fetchError?.message });

    if (fetchError) {
      console.error("[federation-worker] Fetch error:", fetchError);
      throw fetchError;
    }

    if (!queueItems || queueItems.length === 0) {
      console.log("[federation-worker] No pending items");
      return new Response(
        JSON.stringify({ message: "No pending items", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[federation-worker] Processing ${queueItems.length} items`);

    const results: Array<{ id: string; status: string; cid?: string; error?: string }> = [];
    
    // Cache for PDS sessions to avoid repeated lookups
    const sessionCache = new Map<string, PdsSession>();

    for (const item of queueItems as QueueItem[]) {
      console.log(`[federation-worker] Processing ${item.record_type} ${item.record_id} (${item.operation})`);

      // Mark as processing
      await supabase
        .from("federation_queue")
        .update({ 
          status: "processing", 
          processed_at: new Date().toISOString() 
        })
        .eq("id", item.id);

      try {
        // Get user's PDS session (with caching)
        let session = sessionCache.get(item.user_did);
        
        if (!session) {
          // Look up user_id from profiles by DID
          const { data: profile } = await supabase
            .from("profiles")
            .select("id")
            .eq("did", item.user_did)
            .single();

          if (!profile) {
            throw new Error(`No profile found for DID: ${item.user_did}`);
          }

          const { data: sessionData, error: sessionError } = await supabase
            .from("pds_sessions")
            .select("access_jwt, refresh_jwt, user_id")
            .eq("user_id", profile.id)
            .single();

          if (sessionError || !sessionData) {
            throw new Error(`No PDS session found for user: ${item.user_did}`);
          }

          session = sessionData as PdsSession;
          sessionCache.set(item.user_did, session);
        }

        // Execute the operation
        let result: { cid?: string; success: boolean };
        
        switch (item.operation) {
          case 'create':
            result = await createRecord(item, session, supabase);
            break;
          case 'delete':
            result = await deleteRecord(item, session, supabase);
            break;
          case 'update':
            // Update = delete + create (AT Protocol doesn't have update)
            await deleteRecord(item, session, supabase);
            result = await createRecord(item, session, supabase);
            break;
          default:
            throw new Error(`Unknown operation: ${item.operation}`);
        }

        // Mark as synced
        await supabase
          .from("federation_queue")
          .update({
            status: "synced",
            synced_at: new Date().toISOString(),
          })
          .eq("id", item.id);

        // Update the original record with CID (for creates)
        if (result.cid && (item.record_type === "post" || item.record_type === "reply")) {
          await supabase
            .from("posts")
            .update({ at_cid: result.cid })
            .eq("id", item.record_id);
        }

        console.log(`[federation-worker] ✅ Synced ${item.record_type} ${item.record_id}`);
        results.push({ id: item.id, status: "synced", cid: result.cid });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[federation-worker] ❌ Failed ${item.record_type} ${item.record_id}:`, errorMessage);

        // Mark as failed
        await supabase
          .from("federation_queue")
          .update({
            status: item.attempts + 1 >= 5 ? "failed" : "pending", // Retry if under max attempts
            attempts: item.attempts + 1,
            last_error: errorMessage,
          })
          .eq("id", item.id);

        results.push({ id: item.id, status: "failed", error: errorMessage });
      }
    }

    const successCount = results.filter(r => r.status === "synced").length;
    console.log(`[federation-worker] Completed: ${successCount}/${results.length} successful`);

    return new Response(
      JSON.stringify({ 
        processed: results.length, 
        successful: successCount,
        results 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[federation-worker] Worker error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Create a record on the PDS
 */
async function createRecord(
  item: QueueItem, 
  session: PdsSession,
  supabase: any
): Promise<{ cid: string; success: boolean }> {
  if (!item.record_data) {
    throw new Error("No record data for create operation");
  }

  const response = await fetch(`${PDS_URL}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.access_jwt}`,
    },
    body: JSON.stringify({
      repo: item.user_did,
      collection: item.collection,
      rkey: item.rkey,
      record: item.record_data,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    const errorMessage = error.message || error.error || response.statusText;
    
    // Check if it's an auth error (401 OR error mentions token/expired)
    const needsRefresh = response.status === 401 || 
      (errorMessage && (errorMessage.toLowerCase().includes('token') || errorMessage.toLowerCase().includes('expired')));
    
    if (needsRefresh) {
      // Try to refresh the token
      const refreshed = await refreshPdsSession(session.refresh_jwt);
      if (refreshed) {
        // Update stored tokens
        await supabase
          .from("pds_sessions")
          .update({
            access_jwt: refreshed.accessJwt,
            refresh_jwt: refreshed.refreshJwt,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", session.user_id);

        // Retry with new token
        const retryResponse = await fetch(`${PDS_URL}/xrpc/com.atproto.repo.createRecord`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${refreshed.accessJwt}`,
          },
          body: JSON.stringify({
            repo: item.user_did,
            collection: item.collection,
            rkey: item.rkey,
            record: item.record_data,
          }),
        });

        if (!retryResponse.ok) {
          const retryError = await retryResponse.json();
          throw new Error(`PDS error after token refresh: ${retryError.message || retryResponse.statusText}`);
        }

        const retryResult = await retryResponse.json();
        return { cid: retryResult.cid, success: true };
      }
    }

    throw new Error(`PDS error: ${errorMessage}`);
  }

  const result = await response.json();
  return { cid: result.cid, success: true };
}

/**
 * Delete a record from the PDS
 */
async function deleteRecord(
  item: QueueItem, 
  session: PdsSession,
  supabase: any
): Promise<{ success: boolean }> {
  const response = await fetch(`${PDS_URL}/xrpc/com.atproto.repo.deleteRecord`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.access_jwt}`,
    },
    body: JSON.stringify({
      repo: item.user_did,
      collection: item.collection,
      rkey: item.rkey,
    }),
  });

  if (!response.ok) {
    // 404 means already deleted, which is fine
    if (response.status === 404) {
      return { success: true };
    }

    const error = await response.json();
    const errorMessage = error.message || error.error || response.statusText;
    
    // Try token refresh on 401 OR if error mentions token/expired
    const needsRefresh = response.status === 401 || 
      (errorMessage && (errorMessage.toLowerCase().includes('token') || errorMessage.toLowerCase().includes('expired')));
    
    if (needsRefresh) {
      const refreshed = await refreshPdsSession(session.refresh_jwt);
      if (refreshed) {
        await supabase
          .from("pds_sessions")
          .update({
            access_jwt: refreshed.accessJwt,
            refresh_jwt: refreshed.refreshJwt,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", session.user_id);

        const retryResponse = await fetch(`${PDS_URL}/xrpc/com.atproto.repo.deleteRecord`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${refreshed.accessJwt}`,
          },
          body: JSON.stringify({
            repo: item.user_did,
            collection: item.collection,
            rkey: item.rkey,
          }),
        });

        if (!retryResponse.ok && retryResponse.status !== 404) {
          const retryError = await retryResponse.json();
          throw new Error(`PDS delete error after refresh: ${retryError.message || retryResponse.statusText}`);
        }

        return { success: true };
      }
    }

    throw new Error(`PDS delete error: ${errorMessage}`);
  }

  return { success: true };
}

/**
 * Refresh a PDS session token
 */
async function refreshPdsSession(refreshJwt: string): Promise<{ accessJwt: string; refreshJwt: string } | null> {
  try {
    const response = await fetch(`${PDS_URL}/xrpc/com.atproto.server.refreshSession`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${refreshJwt}`,
      },
    });

    if (!response.ok) {
      console.error("[federation-worker] Token refresh failed:", response.status);
      return null;
    }

    return response.json();
  } catch (error) {
    console.error("[federation-worker] Token refresh error:", error);
    return null;
  }
}
