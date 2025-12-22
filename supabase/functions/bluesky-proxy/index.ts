import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const BSKY_PUBLIC_API = "https://public.api.bsky.app/xrpc";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/**
 * ✅ Gold Standard Resilience: fetchWithTimeout
 * Prevents "hanging" upstream requests from blocking your app.
 */
async function fetchWithTimeout(url: string, options = {}, timeout = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "feed";
    const limit = url.searchParams.get("limit") || "50";
    const cursor = url.searchParams.get("cursor") || "";

    let bskyUrl: string;
    
    // Switch on common actions for specific formatting
    switch (action) {
      case "feed":
        const feedUri = "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot";
        bskyUrl = `${BSKY_PUBLIC_API}/app.bsky.feed.getFeed?feed=${encodeURIComponent(feedUri)}&limit=${limit}`;
        if (cursor) bskyUrl += `&cursor=${encodeURIComponent(cursor)}`;
        break;

      case "search":
        const qPost = url.searchParams.get("q") || "";
        bskyUrl = `${BSKY_PUBLIC_API}/app.bsky.feed.searchPosts?q=${encodeURIComponent(qPost)}&sort=latest&limit=${limit}`;
        if (cursor) bskyUrl += `&cursor=${encodeURIComponent(cursor)}`;
        break;

      case "searchActors":
        const qActor = url.searchParams.get("q") || "";
        bskyUrl = `${BSKY_PUBLIC_API}/app.bsky.actor.searchActors?q=${encodeURIComponent(qActor)}&limit=${limit}`;
        break;

      case "trending":
        // Fallback for public use: search for popular activity
        bskyUrl = `${BSKY_PUBLIC_API}/app.bsky.actor.searchActors?q=*&limit=${limit}`;
        break;

      case "trendingTopics":
        bskyUrl = `${BSKY_PUBLIC_API}/app.bsky.unspecced.getTrendingTopics?limit=${limit}`;
        break;

      case "getProfile":
        // Support both "actor" and "handle" params for compatibility
        const actor = url.searchParams.get("actor") || url.searchParams.get("handle") || "";
        bskyUrl = `${BSKY_PUBLIC_API}/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`;
        break;

      case "getAuthorFeed":
        // Support both "actor" and "handle" params for compatibility
        const author = url.searchParams.get("actor") || url.searchParams.get("handle") || "";
        // Filter options: posts_no_replies, posts_with_replies, posts_with_media, posts_and_author_threads
        const filter = url.searchParams.get("filter") || "posts_no_replies";
        bskyUrl = `${BSKY_PUBLIC_API}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(author)}&limit=${limit}&filter=${filter}`;
        if (cursor) bskyUrl += `&cursor=${encodeURIComponent(cursor)}`;
        break;

      case "xrpc":
        // ✅ Gold Standard Resilience: Generic XRPC Passthrough
        const path = url.searchParams.get("path") || url.searchParams.get("endpoint") || "";
        if (!path) throw new Error("Missing XRPC path");
        const xrpcParams = new URLSearchParams();
        url.searchParams.forEach((value, key) => {
          if (!["action", "path", "endpoint"].includes(key)) {
            xrpcParams.set(key, value);
          }
        });
        // Ensure path starts with / for proper URL construction
        const normalizedPath = path.startsWith("/") ? path : `/${path}`;
        bskyUrl = `${BSKY_PUBLIC_API}${normalizedPath}?${xrpcParams.toString()}`;
        break;

      default:
        throw new Error(`Unsupported action: ${action}`);
    }

    console.log("Fetching from Bluesky:", bskyUrl);

    // ✅ Resilience: Wrapped fetch with timeout and error capture
    try {
      const response = await fetchWithTimeout(bskyUrl, {
        headers: { "Accept": "application/json", "User-Agent": "Cannect/1.0" },
      });

      if (!response.ok) {
        throw new Error(`Bluesky Upstream Error: ${response.status}`);
      }

      const data = await response.json();
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } catch (innerError) {
      console.error("Inner Fetch Error:", innerError.message);
      // ✅ Resilience: Return empty sets instead of 500
      const fallback: any = { actors: [], posts: [], feed: [], topics: [] };
      return new Response(JSON.stringify(fallback), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

  } catch (error) {
    console.error("Global Proxy Crash:", error.message);
    return new Response(
      JSON.stringify({ error: error.message, actors: [], posts: [], feed: [] }),
      {
        status: 200, // Return 200 to keep Frontend hooks in a successful (but empty) state
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
