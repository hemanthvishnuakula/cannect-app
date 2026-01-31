#!/usr/bin/env python3
"""
Generate OG Image for Intelligence Reports
Creates a 1200x630 branded image for link previews
"""

from PIL import Image, ImageDraw, ImageFont
import os

# Dimensions for OG image (Facebook/Twitter standard)
WIDTH = 1200
HEIGHT = 630

# Colors
BLACK = (10, 10, 10)
DARK = (24, 24, 27)
GREEN = (16, 185, 129)
WHITE = (250, 250, 250)
GRAY = (161, 161, 170)

def create_og_image(month: str, year: str, output_path: str):
    """Create an OG image for the report"""
    
    # Create image with dark background
    img = Image.new('RGB', (WIDTH, HEIGHT), BLACK)
    draw = ImageDraw.Draw(img)
    
    # Draw a subtle card background
    card_margin = 60
    card_rect = [card_margin, card_margin, WIDTH - card_margin, HEIGHT - card_margin]
    draw.rounded_rectangle(card_rect, radius=24, fill=DARK)
    
    # Draw green accent bar at top
    accent_rect = [card_margin, card_margin, WIDTH - card_margin, card_margin + 8]
    draw.rectangle(accent_rect, fill=GREEN)
    
    # Try to load fonts, fall back to default if not available
    try:
        # Try system fonts
        title_font = ImageFont.truetype("arial.ttf", 72)
        subtitle_font = ImageFont.truetype("arial.ttf", 36)
        brand_font = ImageFont.truetype("arialbd.ttf", 28)
    except:
        try:
            # Try Inter font if available
            title_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 72)
            subtitle_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 36)
            brand_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)
        except:
            # Fall back to default
            title_font = ImageFont.load_default()
            subtitle_font = ImageFont.load_default()
            brand_font = ImageFont.load_default()
    
    # Draw title
    title_text = "Cannabis Consumer"
    title_y = 140
    draw.text((card_margin + 50, title_y), title_text, font=title_font, fill=WHITE)
    
    title_text2 = "Intelligence Report"
    draw.text((card_margin + 50, title_y + 80), title_text2, font=title_font, fill=WHITE)
    
    # Draw month/year
    date_text = f"{month} {year}"
    draw.text((card_margin + 50, title_y + 180), date_text, font=subtitle_font, fill=GREEN)
    
    # Draw description
    desc_text = "Consumer sentiment • Market trends • Brand analysis"
    draw.text((card_margin + 50, title_y + 240), desc_text, font=subtitle_font, fill=GRAY)
    
    # Draw brand at bottom
    brand_text = "CANNECT INTELLIGENCE"
    brand_y = HEIGHT - card_margin - 60
    draw.text((card_margin + 50, brand_y), brand_text, font=brand_font, fill=GREEN)
    
    # Draw green circle checkmark on the right side
    circle_x = WIDTH - card_margin - 150
    circle_y = HEIGHT // 2 - 40
    circle_radius = 60
    
    # Draw filled green circle
    draw.ellipse(
        [circle_x - circle_radius, circle_y - circle_radius, 
         circle_x + circle_radius, circle_y + circle_radius],
        fill=GREEN
    )
    
    # Draw white checkmark inside
    check_points = [
        (circle_x - 25, circle_y),
        (circle_x - 5, circle_y + 20),
        (circle_x + 30, circle_y - 20)
    ]
    draw.line(check_points[:2], fill=WHITE, width=8)
    draw.line(check_points[1:], fill=WHITE, width=8)
    
    # Save image
    img.save(output_path, 'PNG', optimize=True)
    print(f"Created OG image: {output_path}")
    return output_path


if __name__ == "__main__":
    # Generate January 2026 report OG image
    output_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    output_path = os.path.join(output_dir, "public", "og-report-2026-01.png")
    
    create_og_image("January", "2026", output_path)
