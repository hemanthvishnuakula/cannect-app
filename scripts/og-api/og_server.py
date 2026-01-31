#!/usr/bin/env python3
"""
Open Graph Metadata API
Fetches OG/meta tags from URLs for link previews in compose.
"""

import re
import asyncio
from urllib.parse import urlparse
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
from bs4 import BeautifulSoup

app = FastAPI(title="Cannect OG API")

# CORS - allow Cannect domains
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://cannect.space",
        "https://cannect.net",
        "https://www.cannect.net",
        "https://cannect-app.vercel.app",
        "https://cannect-one.vercel.app",
        "http://localhost:8081",
        "http://localhost:19006",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

class OGResponse(BaseModel):
    url: str
    title: str | None = None
    description: str | None = None
    image: str | None = None
    site_name: str | None = None
    error: str | None = None


def clean_url(url: str) -> str:
    """Ensure URL has a scheme"""
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url
    return url


def extract_og_data(html: str, url: str) -> dict:
    """Extract Open Graph and meta tags from HTML"""
    soup = BeautifulSoup(html, 'html.parser')
    
    data = {
        'url': url,
        'title': None,
        'description': None,
        'image': None,
        'site_name': None,
    }
    
    # Open Graph tags
    og_title = soup.find('meta', property='og:title')
    og_desc = soup.find('meta', property='og:description')
    og_image = soup.find('meta', property='og:image')
    og_site = soup.find('meta', property='og:site_name')
    
    if og_title:
        data['title'] = og_title.get('content', '')
    if og_desc:
        data['description'] = og_desc.get('content', '')
    if og_image:
        data['image'] = og_image.get('content', '')
    if og_site:
        data['site_name'] = og_site.get('content', '')
    
    # Twitter card fallbacks
    if not data['title']:
        tw_title = soup.find('meta', attrs={'name': 'twitter:title'})
        if tw_title:
            data['title'] = tw_title.get('content', '')
    
    if not data['description']:
        tw_desc = soup.find('meta', attrs={'name': 'twitter:description'})
        if tw_desc:
            data['description'] = tw_desc.get('content', '')
    
    if not data['image']:
        tw_image = soup.find('meta', attrs={'name': 'twitter:image'})
        if tw_image:
            data['image'] = tw_image.get('content', '')
    
    # Standard meta fallbacks
    if not data['title']:
        title_tag = soup.find('title')
        if title_tag:
            data['title'] = title_tag.get_text(strip=True)
    
    if not data['description']:
        meta_desc = soup.find('meta', attrs={'name': 'description'})
        if meta_desc:
            data['description'] = meta_desc.get('content', '')
    
    # Clean up
    if data['title']:
        data['title'] = data['title'][:300]  # Limit length
    if data['description']:
        data['description'] = data['description'][:500]
    
    # Make image URL absolute
    if data['image'] and not data['image'].startswith('http'):
        parsed = urlparse(url)
        base = f"{parsed.scheme}://{parsed.netloc}"
        if data['image'].startswith('/'):
            data['image'] = base + data['image']
        else:
            data['image'] = base + '/' + data['image']
    
    return data


@app.get("/og")
async def get_og_metadata(url: str) -> OGResponse:
    """Fetch Open Graph metadata for a URL"""
    try:
        url = clean_url(url)
        
        # Validate URL
        parsed = urlparse(url)
        if not parsed.netloc:
            raise HTTPException(status_code=400, detail="Invalid URL")
        
        # Fetch the page
        async with httpx.AsyncClient(
            timeout=10.0,
            follow_redirects=True,
            headers={
                'User-Agent': 'Mozilla/5.0 (compatible; CannectBot/1.0; +https://cannect.space)',
                'Accept': 'text/html,application/xhtml+xml',
            }
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
        
        # Check content type
        content_type = response.headers.get('content-type', '')
        if 'text/html' not in content_type and 'application/xhtml' not in content_type:
            # Not HTML - return basic info
            return OGResponse(
                url=url,
                title=parsed.path.split('/')[-1] or parsed.netloc,
                description=f"File from {parsed.netloc}",
            )
        
        # Extract OG data
        data = extract_og_data(response.text, url)
        return OGResponse(**data)
        
    except httpx.TimeoutException:
        return OGResponse(url=url, error="Request timed out")
    except httpx.HTTPStatusError as e:
        return OGResponse(url=url, error=f"HTTP {e.response.status_code}")
    except Exception as e:
        return OGResponse(url=url, error=str(e))


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8095)
