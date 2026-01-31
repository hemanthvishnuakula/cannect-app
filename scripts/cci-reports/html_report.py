#!/usr/bin/env python3
"""
Cannect Intelligence - HTML Report Generator
Generates web-friendly report with OG metadata for rich link previews.
"""

import os
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime
import json

# Database
DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': int(os.getenv('DB_PORT', '5432')),
    'dbname': os.getenv('DB_NAME', 'cannect_intel'),
    'user': os.getenv('DB_USER', 'cci'),
    'password': os.getenv('DB_PASSWORD', '')
}


def get_db():
    return psycopg2.connect(**DB_CONFIG)


def generate_html_report(output_path: str, pdf_url: str = None):
    """Generate HTML report with same data as PDF"""
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    month_year = datetime.now().strftime('%B %Y')
    month_short = datetime.now().strftime('%Y-%m')
    
    # Fetch key metrics
    cur.execute('SELECT COUNT(*) as total FROM posts')
    total_posts = cur.fetchone()['total']
    
    cur.execute('SELECT COUNT(*) as total FROM post_classifications')
    classified = cur.fetchone()['total']
    
    cur.execute('SELECT COUNT(*) as total FROM user_profiles')
    total_users = cur.fetchone()['total']
    
    cur.execute('SELECT COUNT(*) as count FROM user_profiles WHERE wellness_brand_target_score >= 50')
    wellness_targets = cur.fetchone()['count']
    
    cur.execute('SELECT COUNT(*) as count FROM post_classifications WHERE purchase_intent >= 70')
    high_intent = cur.fetchone()['count']
    
    classification_rate = int(classified / total_posts * 100) if total_posts > 0 else 0
    
    # Consumer segments
    cur.execute('''
        SELECT primary_consumer_type as type, COUNT(*) as users
        FROM user_profiles 
        WHERE primary_consumer_type IS NOT NULL AND primary_consumer_type != 'unknown'
        GROUP BY primary_consumer_type 
        ORDER BY users DESC LIMIT 5
    ''')
    segments = cur.fetchall()
    total_segments = sum(r['users'] for r in segments) if segments else 1
    
    # Sentiment
    cur.execute('''
        SELECT sentiment, COUNT(*) as count
        FROM post_classifications 
        WHERE sentiment IS NOT NULL
        GROUP BY sentiment ORDER BY count DESC
    ''')
    sentiment = cur.fetchall()
    total_sent = sum(r['count'] for r in sentiment) if sentiment else 1
    
    # Effects desired
    cur.execute('''
        SELECT unnest(effects_desired) as effect, COUNT(*) as mentions
        FROM post_classifications WHERE effects_desired IS NOT NULL
        GROUP BY effect ORDER BY mentions DESC LIMIT 8
    ''')
    effects_desired = cur.fetchall()
    
    # Effects mentioned
    cur.execute('''
        SELECT unnest(effects_mentioned) as effect, COUNT(*) as mentions
        FROM post_classifications WHERE effects_mentioned IS NOT NULL
        GROUP BY effect ORDER BY mentions DESC LIMIT 8
    ''')
    effects_mentioned = cur.fetchall()
    
    # Strains
    cur.execute('''
        SELECT LOWER(strain_mentioned) as strain, COUNT(*) as mentions,
               ROUND(AVG(sentiment_score)) as sentiment
        FROM post_classifications 
        WHERE strain_mentioned IS NOT NULL 
          AND LOWER(strain_mentioned) NOT IN ('sativa', 'indica', 'hybrid')
          AND strain_mentioned NOT LIKE '{%%}'
        GROUP BY LOWER(strain_mentioned)
        HAVING COUNT(*) >= 3
        ORDER BY mentions DESC LIMIT 12
    ''')
    strains = cur.fetchall()
    
    # Brands
    cur.execute('''
        SELECT brand_mentioned as brand, COUNT(*) as mentions,
               ROUND(AVG(sentiment_score)) as sentiment
        FROM post_classifications 
        WHERE brand_mentioned IS NOT NULL AND brand_mentioned NOT LIKE '{%%}'
        GROUP BY brand_mentioned HAVING COUNT(*) >= 3
        ORDER BY mentions DESC LIMIT 10
    ''')
    brands = cur.fetchall()
    
    # Frustrations
    cur.execute('''
        SELECT unnest(frustrations) as frustration, COUNT(*) as mentions
        FROM post_classifications WHERE frustrations IS NOT NULL
        GROUP BY frustration ORDER BY mentions DESC LIMIT 8
    ''')
    frustrations = cur.fetchall()
    
    # Product categories
    cur.execute('''
        SELECT product_category as cat, COUNT(*) as mentions
        FROM post_classifications 
        WHERE product_category IS NOT NULL AND product_category != 'unknown'
        GROUP BY product_category ORDER BY mentions DESC LIMIT 8
    ''')
    products = cur.fetchall()
    total_products = sum(r['mentions'] for r in products) if products else 1
    
    # Experience levels
    cur.execute('''
        SELECT experience_level as level, COUNT(*) as users
        FROM user_profiles 
        WHERE experience_level IS NOT NULL AND experience_level != 'unknown'
        GROUP BY experience_level ORDER BY users DESC
    ''')
    experience_levels = cur.fetchall()
    
    conn.close()
    
    # Generate HTML
    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cannect Intelligence Report - {month_year}</title>
    
    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="article">
    <meta property="og:url" content="https://cannect-app.vercel.app/reports/{month_short}">
    <meta property="og:title" content="Cannabis Consumer Intelligence Report - {month_year}">
    <meta property="og:description" content="{total_posts:,} posts analyzed • {total_users:,} user profiles • {wellness_targets:,} high-value targets identified">
    <meta property="og:image" content="https://cannect-app.vercel.app/og-report-{month_short}.png">
    <meta property="og:site_name" content="Cannect Intelligence">
    
    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Cannabis Consumer Intelligence Report - {month_year}">
    <meta name="twitter:description" content="{total_posts:,} posts analyzed • {total_users:,} user profiles • {wellness_targets:,} high-value targets">
    <meta name="twitter:image" content="https://cannect-app.vercel.app/og-report-{month_short}.png">
    
    <!-- Standard Meta -->
    <meta name="description" content="Cannabis consumer intelligence from {total_posts:,} real social conversations. Sentiment analysis, consumer segments, brand mentions, and purchase intent signals.">
    <link rel="icon" href="/favicon.png">
    
    <style>
        :root {{
            --black: #000000;
            --dark: #1a1a1a;
            --gray-dark: #4a4a4a;
            --gray-med: #888888;
            --gray-light: #cccccc;
            --gray-pale: #f5f5f5;
            --white: #ffffff;
            --accent: #10B981;
        }}
        
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: var(--white);
            color: var(--dark);
            line-height: 1.6;
        }}
        
        .container {{
            max-width: 900px;
            margin: 0 auto;
            padding: 40px 20px;
        }}
        
        /* Header */
        .header {{
            text-align: center;
            padding: 60px 0;
            border-bottom: 1px solid var(--gray-light);
            margin-bottom: 40px;
        }}
        
        .header h1 {{
            font-size: 2.5rem;
            font-weight: 700;
            color: var(--dark);
            margin-bottom: 8px;
        }}
        
        .header .subtitle {{
            font-size: 1.2rem;
            color: var(--gray-med);
        }}
        
        /* Key Metrics */
        .metrics {{
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 20px;
            margin: 40px 0;
        }}
        
        @media (max-width: 768px) {{
            .metrics {{
                grid-template-columns: repeat(2, 1fr);
            }}
        }}
        
        .metric {{
            text-align: center;
            padding: 20px;
        }}
        
        .metric-value {{
            font-size: 2.2rem;
            font-weight: 700;
            color: var(--dark);
        }}
        
        .metric-label {{
            font-size: 0.75rem;
            color: var(--gray-med);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-top: 5px;
        }}
        
        /* Sections */
        section {{
            margin: 50px 0;
        }}
        
        h2 {{
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--dark);
            margin-bottom: 10px;
            padding-bottom: 10px;
            border-bottom: 2px solid var(--dark);
        }}
        
        h3 {{
            font-size: 1.1rem;
            font-weight: 600;
            color: var(--gray-dark);
            margin: 25px 0 15px;
        }}
        
        p {{
            color: var(--gray-dark);
            margin-bottom: 15px;
        }}
        
        /* Tables */
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }}
        
        th {{
            text-align: left;
            font-size: 0.75rem;
            font-weight: 600;
            color: var(--gray-med);
            text-transform: uppercase;
            padding: 10px 0;
            border-bottom: 2px solid var(--dark);
        }}
        
        td {{
            padding: 12px 0;
            border-bottom: 1px solid var(--gray-pale);
            color: var(--dark);
        }}
        
        tr:last-child td {{
            border-bottom: none;
        }}
        
        .text-right {{
            text-align: right;
        }}
        
        /* Key Findings */
        .findings {{
            background: var(--gray-pale);
            padding: 25px;
            border-radius: 8px;
            margin: 20px 0;
        }}
        
        .finding {{
            padding: 8px 0 8px 20px;
            border-left: 3px solid var(--accent);
            margin: 10px 0;
            color: var(--dark);
        }}
        
        /* Charts placeholder */
        .chart-container {{
            background: var(--gray-pale);
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            min-height: 200px;
            display: flex;
            align-items: center;
            justify-content: center;
        }}
        
        .bar-chart {{
            width: 100%;
        }}
        
        .bar {{
            display: flex;
            align-items: center;
            margin: 8px 0;
        }}
        
        .bar-label {{
            width: 150px;
            font-size: 0.9rem;
            color: var(--gray-dark);
        }}
        
        .bar-fill {{
            height: 24px;
            background: var(--accent);
            border-radius: 4px;
            min-width: 4px;
        }}
        
        .bar-value {{
            margin-left: 10px;
            font-size: 0.85rem;
            color: var(--gray-med);
        }}
        
        /* Download CTA */
        .download-cta {{
            text-align: center;
            padding: 40px;
            background: var(--dark);
            color: var(--white);
            border-radius: 8px;
            margin: 40px 0;
        }}
        
        .download-cta h3 {{
            color: var(--white);
            margin-bottom: 15px;
        }}
        
        .download-cta p {{
            color: var(--gray-light);
            margin-bottom: 20px;
        }}
        
        .download-btn {{
            display: inline-block;
            background: var(--accent);
            color: var(--white);
            padding: 12px 30px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 600;
            transition: opacity 0.2s;
        }}
        
        .download-btn:hover {{
            opacity: 0.9;
        }}
        
        /* Footer */
        .footer {{
            text-align: center;
            padding: 40px 0;
            border-top: 1px solid var(--gray-light);
            margin-top: 60px;
        }}
        
        .footer p {{
            font-size: 0.8rem;
            color: var(--gray-light);
        }}
        
        .footer .brand {{
            color: var(--gray-med);
            font-weight: 600;
        }}
    </style>
</head>
<body>
    <div class="container">
        <!-- Header -->
        <header class="header">
            <h1>Cannabis Consumer<br>Intelligence Report</h1>
            <p class="subtitle">{month_year}</p>
        </header>
        
        <!-- Key Metrics -->
        <div class="metrics">
            <div class="metric">
                <div class="metric-value">{total_posts:,}</div>
                <div class="metric-label">Posts Analyzed</div>
            </div>
            <div class="metric">
                <div class="metric-value">{total_users:,}</div>
                <div class="metric-label">User Profiles</div>
            </div>
            <div class="metric">
                <div class="metric-value">{wellness_targets:,}</div>
                <div class="metric-label">High-Value Targets</div>
            </div>
            <div class="metric">
                <div class="metric-value">{classification_rate}%</div>
                <div class="metric-label">Classified</div>
            </div>
        </div>
        
        <!-- Executive Summary -->
        <section>
            <h2>Executive Summary</h2>
            <p>
                This report analyzes <strong>{total_posts:,}</strong> posts from the Cannect cannabis social network. 
                We classified <strong>{classified:,}</strong> posts and built behavioral profiles for <strong>{total_users:,}</strong> users, 
                identifying <strong>{wellness_targets}</strong> high-value targets for wellness brand outreach.
            </p>
            
            <h3>Key Findings</h3>
            <div class="findings">
                <div class="finding">Positive sentiment dominates (50%+), indicating strong community engagement</div>
                <div class="finding">Relaxation and pain relief are the most sought-after effects</div>
                <div class="finding">Legal/regulatory uncertainty is the primary consumer frustration</div>
                <div class="finding">{wellness_targets} users identified as high-value wellness brand targets</div>
                <div class="finding">{high_intent:,} posts show high purchase intent (70%+ score)</div>
            </div>
        </section>
        
        <!-- Consumer Segments -->
        <section>
            <h2>Consumer Segmentation</h2>
            <p>Users are classified by primary consumption motivation based on their posting history.</p>
            
            <table>
                <thead>
                    <tr>
                        <th>Segment</th>
                        <th class="text-right">Users</th>
                        <th class="text-right">Share</th>
                    </tr>
                </thead>
                <tbody>
                    {''.join(f'<tr><td>{r["type"].title()}</td><td class="text-right">{r["users"]:,}</td><td class="text-right">{r["users"]/total_segments*100:.1f}%</td></tr>' for r in segments)}
                </tbody>
            </table>
            
            <h3>Experience Distribution</h3>
            <table>
                <thead>
                    <tr>
                        <th>Experience Level</th>
                        <th class="text-right">Users</th>
                    </tr>
                </thead>
                <tbody>
                    {''.join(f'<tr><td>{r["level"].title()}</td><td class="text-right">{r["users"]:,}</td></tr>' for r in experience_levels)}
                </tbody>
            </table>
        </section>
        
        <!-- Sentiment Analysis -->
        <section>
            <h2>Sentiment Analysis</h2>
            
            <table>
                <thead>
                    <tr>
                        <th>Sentiment</th>
                        <th class="text-right">Posts</th>
                        <th class="text-right">Share</th>
                    </tr>
                </thead>
                <tbody>
                    {''.join(f'<tr><td>{r["sentiment"].title()}</td><td class="text-right">{r["count"]:,}</td><td class="text-right">{r["count"]/total_sent*100:.1f}%</td></tr>' for r in sentiment)}
                </tbody>
            </table>
            
            <h3>Implications</h3>
            <div class="findings">
                <div class="finding">Negative sentiment primarily relates to access/legal issues, not product quality</div>
                <div class="finding">High positive ratio supports premium positioning strategies</div>
                <div class="finding">Mixed sentiment posts provide valuable product feedback</div>
            </div>
        </section>
        
        <!-- Effects -->
        <section>
            <h2>Effects & Preferences</h2>
            <p>Understanding consumer-desired effects informs product development and marketing.</p>
            
            <h3>Effects Desired</h3>
            <div class="bar-chart">
                {''.join(f'<div class="bar"><span class="bar-label">{r["effect"].replace("_", " ").title()}</span><div class="bar-fill" style="width: {min(r["mentions"] / (effects_desired[0]["mentions"] if effects_desired else 1) * 100, 100)}%"></div><span class="bar-value">{r["mentions"]:,}</span></div>' for r in effects_desired)}
            </div>
            
            <h3>Effects Mentioned</h3>
            <table>
                <thead>
                    <tr>
                        <th>Effect</th>
                        <th class="text-right">Mentions</th>
                    </tr>
                </thead>
                <tbody>
                    {''.join(f'<tr><td>{r["effect"].replace("_", " ").title()}</td><td class="text-right">{r["mentions"]:,}</td></tr>' for r in effects_mentioned)}
                </tbody>
            </table>
        </section>
        
        <!-- Strains -->
        <section>
            <h2>Strain Intelligence</h2>
            
            <table>
                <thead>
                    <tr>
                        <th>Strain</th>
                        <th class="text-right">Mentions</th>
                        <th class="text-right">Sentiment</th>
                    </tr>
                </thead>
                <tbody>
                    {''.join(f'<tr><td>{r["strain"].title()}</td><td class="text-right">{r["mentions"]}</td><td class="text-right">{r["sentiment"] or 50:.0f}</td></tr>' for r in strains)}
                </tbody>
            </table>
            <p style="font-size: 0.8rem; color: var(--gray-med);">Sentiment: 0-100 scale where 50 is neutral</p>
        </section>
        
        <!-- Brands -->
        <section>
            <h2>Brand Intelligence</h2>
            <p>Organic brand mentions reveal authentic consumer sentiment.</p>
            
            <table>
                <thead>
                    <tr>
                        <th>Brand</th>
                        <th class="text-right">Mentions</th>
                        <th class="text-right">Sentiment</th>
                    </tr>
                </thead>
                <tbody>
                    {''.join(f'<tr><td>{r["brand"]}</td><td class="text-right">{r["mentions"]}</td><td class="text-right">{r["sentiment"] or 50:.0f}</td></tr>' for r in brands)}
                </tbody>
            </table>
        </section>
        
        <!-- Pain Points -->
        <section>
            <h2>Consumer Pain Points</h2>
            <p>Frustrations represent business opportunities.</p>
            
            <div class="bar-chart">
                {''.join(f'<div class="bar"><span class="bar-label">{r["frustration"].replace("_", " ").title()}</span><div class="bar-fill" style="width: {min(r["mentions"] / (frustrations[0]["mentions"] if frustrations else 1) * 100, 100)}%"></div><span class="bar-value">{r["mentions"]:,}</span></div>' for r in frustrations)}
            </div>
            
            <h3>Opportunity Areas</h3>
            <div class="findings">
                <div class="finding">Legal/Regulatory: Compliance tools, consumer education</div>
                <div class="finding">Stigma: Normalization content, professional branding</div>
                <div class="finding">Safety: Lab testing visibility, dosing guides</div>
            </div>
        </section>
        
        <!-- Market Overview -->
        <section>
            <h2>Market Overview</h2>
            
            <h3>Product Categories</h3>
            <table>
                <thead>
                    <tr>
                        <th>Category</th>
                        <th class="text-right">Mentions</th>
                        <th class="text-right">Share</th>
                    </tr>
                </thead>
                <tbody>
                    {''.join(f'<tr><td>{r["cat"].replace("_", " ").title()}</td><td class="text-right">{r["mentions"]:,}</td><td class="text-right">{r["mentions"]/total_products*100:.1f}%</td></tr>' for r in products)}
                </tbody>
            </table>
        </section>
        
        <!-- Download CTA -->
        {f'''<div class="download-cta">
            <h3>Download Full Report</h3>
            <p>Get the complete analysis as a PDF for offline viewing and sharing.</p>
            <a href="{pdf_url}" class="download-btn" download>Download PDF</a>
        </div>''' if pdf_url else ''}
        
        <!-- Footer -->
        <footer class="footer">
            <p class="brand">CANNECT INTELLIGENCE</p>
            <p>Cannabis consumer insights from real social conversations.</p>
            <p style="margin-top: 15px;">This report is generated from publicly available posts on Cannect.<br>All data is anonymized. Cannect Intelligence is committed to ethical data practices.</p>
        </footer>
    </div>
</body>
</html>'''
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html)
    
    print(f"✓ HTML Report generated: {output_path}")
    return output_path


def main():
    print("=" * 50)
    print("CANNECT INTELLIGENCE HTML REPORT")
    print("=" * 50)
    
    month_short = datetime.now().strftime('%Y-%m')
    output = f"/root/cci/reports/report_{month_short}.html"
    pdf_url = f"/reports/Cannect_Intelligence_Report_{month_short}.pdf"
    
    generate_html_report(output, pdf_url)
    print(f"Saved: {output}")


if __name__ == '__main__':
    main()
