import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const BSKY_PUBLIC_API = "https://public.api.bsky.app/xrpc";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

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
    
    if (action === "feed") {
      // Use a popular public feed generator (Discover feed)
      // This is Bluesky's "What's Hot" feed
      const feedUri = "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot";
      bskyUrl = `${BSKY_PUBLIC_API}/app.bsky.feed.getFeed?feed=${encodeURIComponent(feedUri)}&limit=${limit}`;
      if (cursor) {
        bskyUrl += `&cursor=${encodeURIComponent(cursor)}`;
      }
    } else if (action === "search") {
      const query = url.searchParams.get("q") || "";
      bskyUrl = `${BSKY_PUBLIC_API}/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&sort=latest&limit=${limit}`;
      if (cursor) {
        bskyUrl += `&cursor=${encodeURIComponent(cursor)}`;
      }
    } else {
      throw new Error("Invalid action");
    }

    console.log("Fetching from Bluesky:", bskyUrl);

    const response = await fetch(bskyUrl, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Cannect/1.0",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Bluesky API error:", response.status, errorText);
      throw new Error(`Bluesky API error: ${response.status}`);
    }

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    console.error("Proxy error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to fetch from Bluesky" }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
