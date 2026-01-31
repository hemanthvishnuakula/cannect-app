/**
 * OG Metadata API - Vercel Serverless Function
 * Proxies to the OG API server or fetches OG data directly
 */

export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return new Response(JSON.stringify({ error: 'URL parameter required' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  try {
    // Fetch the page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Cannect/1.0 (Link Preview Bot)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    const html = await response.text();

    // Parse OG tags
    const getMetaContent = (property) => {
      // Try og: prefix
      let match = html.match(new RegExp(`<meta[^>]*property=["']og:${property}["'][^>]*content=["']([^"']+)["']`, 'i'));
      if (!match) {
        match = html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:${property}["']`, 'i'));
      }
      // Try twitter: prefix
      if (!match) {
        match = html.match(new RegExp(`<meta[^>]*name=["']twitter:${property}["'][^>]*content=["']([^"']+)["']`, 'i'));
      }
      if (!match) {
        match = html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:${property}["']`, 'i'));
      }
      return match ? match[1] : null;
    };

    // Get title - try og:title, then twitter:title, then <title>
    let title = getMetaContent('title');
    if (!title) {
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      title = titleMatch ? titleMatch[1].trim() : null;
    }

    // Get description
    let description = getMetaContent('description');
    if (!description) {
      const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
      if (!descMatch) {
        const descMatch2 = html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
        description = descMatch2 ? descMatch2[1] : null;
      } else {
        description = descMatch[1];
      }
    }

    // Get image
    let image = getMetaContent('image');

    // Make image URL absolute if relative
    if (image && !image.startsWith('http')) {
      const urlObj = new URL(url);
      image = image.startsWith('/') 
        ? `${urlObj.protocol}//${urlObj.host}${image}`
        : `${urlObj.protocol}//${urlObj.host}/${image}`;
    }

    const result = {
      url,
      title: title || null,
      description: description || null,
      image: image || null,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      url, 
      error: error.message || 'Failed to fetch OG data' 
    }), {
      status: 200, // Return 200 with error in body so client can handle gracefully
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
