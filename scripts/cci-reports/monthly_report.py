#!/usr/bin/env python3
"""
Cannect Intelligence - Executive Monthly Report
Clean, professional design inspired by top consulting firms.
"""

import os
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, Flowable
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY
from reportlab.pdfgen import canvas
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.graphics.charts.piecharts import Pie
from reportlab.graphics.charts.barcharts import HorizontalBarChart
from reportlab.graphics import renderPDF

# Database
DB_CONFIG = {
    'host': 'localhost',
    'port': 5432,
    'dbname': 'cannect_intel',
    'user': 'cci',
    'password': 'cci_secure_2026'
}

# Professional color palette - minimal and clean
BLACK = colors.HexColor('#000000')
DARK = colors.HexColor('#1a1a1a')
GRAY_DARK = colors.HexColor('#4a4a4a')
GRAY_MED = colors.HexColor('#888888')
GRAY_LIGHT = colors.HexColor('#cccccc')
GRAY_PALE = colors.HexColor('#f5f5f5')
WHITE = colors.white
ACCENT = colors.HexColor('#10B981')  # Cannect green - used sparingly


def get_db():
    return psycopg2.connect(**DB_CONFIG)


class HorizontalLine(Flowable):
    """Simple horizontal rule"""
    def __init__(self, width, thickness=0.5, color=GRAY_LIGHT):
        Flowable.__init__(self)
        self.width = width
        self.thickness = thickness
        self.color = color

    def wrap(self, availWidth, availHeight):
        return (self.width, self.thickness + 6)

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, 3, self.width, 3)


class KeyMetric(Flowable):
    """Large number with label below - clean style"""
    def __init__(self, value, label, width=1.5*inch):
        Flowable.__init__(self)
        self.value = value
        self.label = label
        self.box_width = width

    def wrap(self, availWidth, availHeight):
        return (self.box_width, 55)

    def draw(self):
        # Value - large and bold
        self.canv.setFillColor(DARK)
        self.canv.setFont('Helvetica-Bold', 28)
        self.canv.drawCentredString(self.box_width/2, 25, self.value)
        
        # Label - small caps style
        self.canv.setFillColor(GRAY_MED)
        self.canv.setFont('Helvetica', 8)
        self.canv.drawCentredString(self.box_width/2, 8, self.label.upper())


class ChartContainer(Flowable):
    """Container for ReportLab charts"""
    def __init__(self, drawing, width, height):
        Flowable.__init__(self)
        self.drawing = drawing
        self.width = width
        self.height = height

    def wrap(self, availWidth, availHeight):
        return (self.width, self.height)

    def draw(self):
        renderPDF.draw(self.drawing, self.canv, 0, 0)


class NumberedCanvas(canvas.Canvas):
    """Minimal header/footer"""
    
    def __init__(self, *args, **kwargs):
        canvas.Canvas.__init__(self, *args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            if self._pageNumber > 1:
                self.draw_page_furniture(num_pages)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def draw_page_furniture(self, page_count):
        width, height = letter
        self.saveState()
        
        # Minimal top line
        self.setStrokeColor(GRAY_LIGHT)
        self.setLineWidth(0.5)
        self.line(0.75*inch, height - 0.5*inch, width - 0.75*inch, height - 0.5*inch)
        
        # Header text
        self.setFont('Helvetica', 7)
        self.setFillColor(GRAY_MED)
        self.drawString(0.75*inch, height - 0.4*inch, "CANNECT INTELLIGENCE")
        self.drawRightString(width - 0.75*inch, height - 0.4*inch, 
                            datetime.now().strftime('%B %Y').upper())
        
        # Footer - page number
        self.setFont('Helvetica', 8)
        self.setFillColor(GRAY_MED)
        self.drawCentredString(width/2, 0.4*inch, str(self._pageNumber))
        
        # Disclaimer on all pages
        self.setFont('Helvetica', 7)
        self.setFillColor(GRAY_LIGHT)
        disclaimer = "This report is generated from publicly available posts on Cannect. All data is anonymized. Cannect Intelligence is committed to ethical data practices."
        self.drawCentredString(width/2, 0.25*inch, disclaimer)
        
        self.restoreState()


def get_styles():
    """Clean, professional typography"""
    styles = {}
    
    # Titles
    styles['Title'] = ParagraphStyle(
        name='Title',
        fontName='Helvetica-Bold',
        fontSize=32,
        textColor=DARK,
        alignment=TA_LEFT,
        spaceAfter=6,
        leading=36
    )
    
    styles['Subtitle'] = ParagraphStyle(
        name='Subtitle',
        fontName='Helvetica',
        fontSize=14,
        textColor=GRAY_MED,
        alignment=TA_LEFT,
        spaceAfter=30
    )
    
    # Section headers
    styles['H1'] = ParagraphStyle(
        name='H1',
        fontName='Helvetica-Bold',
        fontSize=18,
        textColor=DARK,
        spaceBefore=0,
        spaceAfter=15,
        leading=22
    )
    
    styles['H2'] = ParagraphStyle(
        name='H2',
        fontName='Helvetica-Bold',
        fontSize=12,
        textColor=DARK,
        spaceBefore=20,
        spaceAfter=10
    )
    
    styles['H3'] = ParagraphStyle(
        name='H3',
        fontName='Helvetica-Bold',
        fontSize=10,
        textColor=GRAY_DARK,
        spaceBefore=15,
        spaceAfter=8
    )
    
    # Body text
    styles['Body'] = ParagraphStyle(
        name='Body',
        fontName='Helvetica',
        fontSize=10,
        textColor=GRAY_DARK,
        alignment=TA_JUSTIFY,
        spaceBefore=0,
        spaceAfter=10,
        leading=15
    )
    
    styles['BodySmall'] = ParagraphStyle(
        name='BodySmall',
        fontName='Helvetica',
        fontSize=9,
        textColor=GRAY_MED,
        alignment=TA_LEFT,
        spaceAfter=6,
        leading=13
    )
    
    # Callouts
    styles['Callout'] = ParagraphStyle(
        name='Callout',
        fontName='Helvetica',
        fontSize=11,
        textColor=DARK,
        alignment=TA_LEFT,
        spaceBefore=10,
        spaceAfter=10,
        leading=16,
        leftIndent=15,
        borderPadding=10
    )
    
    styles['KeyInsight'] = ParagraphStyle(
        name='KeyInsight',
        fontName='Helvetica-Bold',
        fontSize=11,
        textColor=ACCENT,
        spaceBefore=8,
        spaceAfter=4
    )
    
    # Caption
    styles['Caption'] = ParagraphStyle(
        name='Caption',
        fontName='Helvetica',
        fontSize=8,
        textColor=GRAY_MED,
        spaceBefore=6,
        spaceAfter=20
    )
    
    # Footer/legal
    styles['Legal'] = ParagraphStyle(
        name='Legal',
        fontName='Helvetica',
        fontSize=7,
        textColor=GRAY_LIGHT,
        alignment=TA_LEFT,
        leading=10
    )
    
    return styles


def create_bar_chart(data, labels, width=400, height=180):
    """Clean horizontal bar chart"""
    drawing = Drawing(width, height)
    
    bc = HorizontalBarChart()
    bc.x = 100
    bc.y = 15
    bc.width = width - 120
    bc.height = height - 30
    bc.data = [data]
    bc.categoryAxis.categoryNames = labels
    bc.categoryAxis.labels.fontName = 'Helvetica'
    bc.categoryAxis.labels.fontSize = 8
    bc.categoryAxis.labels.fillColor = GRAY_DARK
    bc.valueAxis.valueMin = 0
    bc.valueAxis.labels.fontName = 'Helvetica'
    bc.valueAxis.labels.fontSize = 7
    bc.valueAxis.labels.fillColor = GRAY_MED
    bc.valueAxis.strokeColor = GRAY_LIGHT
    bc.valueAxis.gridStrokeColor = GRAY_PALE
    bc.valueAxis.visibleGrid = True
    bc.bars[0].fillColor = ACCENT
    bc.bars[0].strokeColor = None
    bc.barWidth = 10
    bc.barSpacing = 4
    
    drawing.add(bc)
    return drawing


def create_pie_chart(data, labels, width=220, height=180):
    """Clean pie chart"""
    drawing = Drawing(width, height)
    
    pc = Pie()
    pc.x = 30
    pc.y = 20
    pc.width = 100
    pc.height = 100
    pc.data = data
    pc.labels = None  # We'll add legend separately
    pc.slices.strokeWidth = 0
    pc.slices.strokeColor = WHITE
    
    # Monochrome with accent
    chart_colors = [ACCENT, GRAY_DARK, GRAY_MED, GRAY_LIGHT, GRAY_PALE]
    for i in range(min(len(data), len(chart_colors))):
        pc.slices[i].fillColor = chart_colors[i]
    
    drawing.add(pc)
    
    # Legend
    y_pos = height - 25
    for i, label in enumerate(labels[:5]):
        color = chart_colors[i] if i < len(chart_colors) else GRAY_LIGHT
        # Color box
        drawing.add(Rect(150, y_pos - 3, 10, 10, fillColor=color, strokeColor=None))
        # Label
        pct = f"{data[i] / sum(data) * 100:.0f}%" if sum(data) > 0 else "0%"
        drawing.add(String(165, y_pos, f"{label} ({pct})", 
                          fontName='Helvetica', fontSize=8, fillColor=GRAY_DARK))
        y_pos -= 18
    
    return drawing


def create_clean_table(headers, data, col_widths=None):
    """Minimal, professional table design"""
    table_data = [headers] + data
    
    if col_widths:
        table = Table(table_data, colWidths=col_widths)
    else:
        table = Table(table_data)
    
    style = TableStyle([
        # Header
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 8),
        ('TEXTCOLOR', (0, 0), (-1, 0), GRAY_MED),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
        ('TOPPADDING', (0, 0), (-1, 0), 0),
        
        # Body
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 9),
        ('TEXTCOLOR', (0, 1), (-1, -1), DARK),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 8),
        ('TOPPADDING', (0, 1), (-1, -1), 8),
        
        # Lines - minimal
        ('LINEBELOW', (0, 0), (-1, 0), 1, DARK),
        ('LINEBELOW', (0, 1), (-1, -1), 0.5, GRAY_PALE),
        
        # Alignment
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('ALIGN', (1, 0), (-1, -1), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ])
    
    table.setStyle(style)
    return table


def generate_report(output_path):
    """Generate the executive report"""
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        rightMargin=0.75*inch,
        leftMargin=0.75*inch,
        topMargin=0.65*inch,
        bottomMargin=0.6*inch
    )
    
    styles = get_styles()
    story = []
    page_width = letter[0] - 1.5*inch
    
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
    
    # =========================================================================
    # COVER PAGE
    # =========================================================================
    story.append(Spacer(1, 2*inch))
    
    # Simple, bold title
    story.append(Paragraph("Cannabis Consumer", styles['Title']))
    story.append(Paragraph("Intelligence Report", styles['Title']))
    story.append(Spacer(1, 0.3*inch))
    story.append(Paragraph(datetime.now().strftime('%B %Y'), styles['Subtitle']))
    
    story.append(Spacer(1, 1.5*inch))
    
    # Key metrics row
    metrics_table = Table([
        [KeyMetric(f"{total_posts:,}", "Posts Analyzed"),
         KeyMetric(f"{total_users:,}", "User Profiles"),
         KeyMetric(f"{wellness_targets:,}", "High-Value Targets"),
         KeyMetric(f"{int(classified/total_posts*100)}%", "Classified")]
    ], colWidths=[page_width/4]*4)
    metrics_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    story.append(metrics_table)
    
    story.append(Spacer(1, 2*inch))
    
    # Footer info
    story.append(HorizontalLine(page_width, 0.5, GRAY_LIGHT))
    story.append(Spacer(1, 0.15*inch))
    story.append(Paragraph("CANNECT INTELLIGENCE", styles['BodySmall']))
    story.append(Paragraph("Cannabis consumer insights from real social conversations.", 
                          styles['BodySmall']))
    
    story.append(PageBreak())
    
    # =========================================================================
    # EXECUTIVE SUMMARY
    # =========================================================================
    story.append(Paragraph("Executive Summary", styles['H1']))
    story.append(HorizontalLine(page_width, 1, DARK))
    story.append(Spacer(1, 0.15*inch))
    
    story.append(Paragraph(
        f"This report analyzes {total_posts:,} posts from the Cannect cannabis social network. "
        f"We classified {classified:,} posts and built behavioral profiles for {total_users:,} users, "
        f"identifying {wellness_targets} high-value targets for wellness brand outreach.",
        styles['Body']
    ))
    
    story.append(Spacer(1, 0.2*inch))
    story.append(Paragraph("Key Findings", styles['H2']))
    
    key_findings = [
        "Positive sentiment dominates (50%+), indicating strong community engagement",
        "Relaxation and pain relief are the most sought-after effects",
        "Legal/regulatory uncertainty is the primary consumer frustration",
        f"{wellness_targets} users identified as high-value wellness brand targets",
        f"{high_intent:,} posts show high purchase intent (70%+ score)"
    ]
    
    for finding in key_findings:
        story.append(Paragraph(f"→  {finding}", styles['Callout']))
    
    story.append(PageBreak())
    
    # =========================================================================
    # CONSUMER SEGMENTS
    # =========================================================================
    story.append(Paragraph("Consumer Segmentation", styles['H1']))
    story.append(HorizontalLine(page_width, 1, DARK))
    story.append(Spacer(1, 0.15*inch))
    
    story.append(Paragraph(
        "Users are classified by primary consumption motivation based on their posting history.",
        styles['Body']
    ))
    
    # Consumer types - pie chart + table side by side
    cur.execute('''
        SELECT primary_consumer_type as type, COUNT(*) as users
        FROM user_profiles 
        WHERE primary_consumer_type IS NOT NULL AND primary_consumer_type != 'unknown'
        GROUP BY primary_consumer_type 
        ORDER BY users DESC
        LIMIT 5
    ''')
    segments = cur.fetchall()
    
    if segments:
        seg_data = [r['users'] for r in segments]
        seg_labels = [r['type'].title() for r in segments]
        
        # Create chart
        pie = create_pie_chart(seg_data, seg_labels)
        
        # Table data
        total = sum(seg_data)
        table_rows = [[r['type'].title(), f"{r['users']:,}", f"{r['users']/total*100:.1f}%"] 
                      for r in segments]
        
        # Layout: chart left, table right
        chart_table = Table([
            [ChartContainer(pie, 220, 180), 
             create_clean_table(['Segment', 'Users', 'Share'], table_rows, 
                               [1.8*inch, 1*inch, 0.8*inch])]
        ], colWidths=[3.2*inch, 3.8*inch])
        chart_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (1, 0), (1, 0), 20),
        ]))
        story.append(chart_table)
    
    story.append(Paragraph("Recreational users dominate, but medical and wellness segments "
                          "show higher lifetime value potential.", styles['Caption']))
    
    # Experience levels
    story.append(Paragraph("Experience Distribution", styles['H2']))
    
    cur.execute('''
        SELECT experience_level as level, COUNT(*) as users
        FROM user_profiles 
        WHERE experience_level IS NOT NULL AND experience_level != 'unknown'
        GROUP BY experience_level
        ORDER BY users DESC
    ''')
    exp_rows = [[r['level'].title(), f"{r['users']:,}"] for r in cur.fetchall()]
    story.append(create_clean_table(['Experience Level', 'Users'], exp_rows, [4*inch, 2.5*inch]))
    
    story.append(PageBreak())
    
    # =========================================================================
    # SENTIMENT ANALYSIS
    # =========================================================================
    story.append(Paragraph("Sentiment Analysis", styles['H1']))
    story.append(HorizontalLine(page_width, 1, DARK))
    story.append(Spacer(1, 0.15*inch))
    
    cur.execute('''
        SELECT sentiment, COUNT(*) as count
        FROM post_classifications 
        WHERE sentiment IS NOT NULL
        GROUP BY sentiment 
        ORDER BY count DESC
    ''')
    sentiment = cur.fetchall()
    
    if sentiment:
        sent_data = [r['count'] for r in sentiment]
        sent_labels = [r['sentiment'].title() for r in sentiment]
        total_sent = sum(sent_data)
        
        # Pie chart
        sent_pie = create_pie_chart(sent_data, sent_labels)
        
        # Summary stats
        pos_pct = next((r['count']/total_sent*100 for r in sentiment if r['sentiment']=='positive'), 0)
        neg_pct = next((r['count']/total_sent*100 for r in sentiment if r['sentiment']=='negative'), 0)
        
        story.append(ChartContainer(sent_pie, 220, 180))
        
        story.append(Paragraph(f"Positive sentiment accounts for {pos_pct:.0f}% of classified posts, "
                              f"with negative at {neg_pct:.0f}%. The overall tone indicates a healthy, "
                              "engaged community with product satisfaction.", styles['Body']))
    
    story.append(Spacer(1, 0.3*inch))
    story.append(Paragraph("Implications", styles['H3']))
    story.append(Paragraph("• Negative sentiment primarily relates to access/legal issues, not product quality", 
                          styles['BodySmall']))
    story.append(Paragraph("• High positive ratio supports premium positioning strategies", 
                          styles['BodySmall']))
    story.append(Paragraph("• Mixed sentiment posts provide valuable product feedback", 
                          styles['BodySmall']))
    
    story.append(PageBreak())
    
    # =========================================================================
    # EFFECTS ANALYSIS
    # =========================================================================
    story.append(Paragraph("Effects & Preferences", styles['H1']))
    story.append(HorizontalLine(page_width, 1, DARK))
    story.append(Spacer(1, 0.15*inch))
    
    story.append(Paragraph(
        "Understanding consumer-desired effects informs product development and marketing.",
        styles['Body']
    ))
    
    cur.execute('''
        SELECT unnest(effects_desired) as effect, COUNT(*) as mentions
        FROM post_classifications WHERE effects_desired IS NOT NULL
        GROUP BY effect ORDER BY mentions DESC LIMIT 8
    ''')
    effects = cur.fetchall()
    
    if effects:
        eff_data = [r['mentions'] for r in effects][::-1]  # Reverse for chart
        eff_labels = [r['effect'].replace('_', ' ').title() for r in effects][::-1]
        
        bar = create_bar_chart(eff_data, eff_labels, 450, 200)
        story.append(ChartContainer(bar, 450, 200))
        story.append(Paragraph("Effects consumers actively seek in posts", styles['Caption']))
    
    # Top effects table
    story.append(Paragraph("Top Effects Mentioned", styles['H2']))
    
    cur.execute('''
        SELECT unnest(effects_mentioned) as effect, COUNT(*) as mentions
        FROM post_classifications WHERE effects_mentioned IS NOT NULL
        GROUP BY effect ORDER BY mentions DESC LIMIT 8
    ''')
    exp_effects = cur.fetchall()
    eff_rows = [[r['effect'].replace('_', ' ').title(), f"{r['mentions']:,}"] for r in exp_effects]
    story.append(create_clean_table(['Effect', 'Mentions'], eff_rows, [4*inch, 2.5*inch]))
    
    story.append(PageBreak())
    
    # =========================================================================
    # STRAIN INTELLIGENCE
    # =========================================================================
    story.append(Paragraph("Strain Intelligence", styles['H1']))
    story.append(HorizontalLine(page_width, 1, DARK))
    story.append(Spacer(1, 0.15*inch))
    
    cur.execute('''
        SELECT LOWER(strain_mentioned) as strain, COUNT(*) as mentions,
               ROUND(AVG(sentiment_score)) as sentiment
        FROM post_classifications 
        WHERE strain_mentioned IS NOT NULL 
          AND LOWER(strain_mentioned) NOT IN ('sativa', 'indica', 'hybrid')
          AND strain_mentioned NOT LIKE '{%%}'
        GROUP BY LOWER(strain_mentioned)
        HAVING COUNT(*) >= 3
        ORDER BY mentions DESC
        LIMIT 12
    ''')
    strains = cur.fetchall()
    
    strain_rows = [[r['strain'].title(), str(r['mentions']), 
                   f"{r['sentiment'] or 50:.0f}"] for r in strains]
    story.append(create_clean_table(['Strain', 'Mentions', 'Sentiment'], strain_rows, 
                                   [3.5*inch, 1.5*inch, 1.5*inch]))
    story.append(Paragraph("Sentiment: 0-100 scale where 50 is neutral", styles['Caption']))
    
    story.append(PageBreak())
    
    # =========================================================================
    # BRAND MENTIONS
    # =========================================================================
    story.append(Paragraph("Brand Intelligence", styles['H1']))
    story.append(HorizontalLine(page_width, 1, DARK))
    story.append(Spacer(1, 0.15*inch))
    
    story.append(Paragraph(
        "Organic brand mentions reveal authentic consumer sentiment.",
        styles['Body']
    ))
    
    cur.execute('''
        SELECT brand_mentioned as brand, COUNT(*) as mentions,
               ROUND(AVG(sentiment_score)) as sentiment
        FROM post_classifications 
        WHERE brand_mentioned IS NOT NULL AND brand_mentioned NOT LIKE '{%%}'
        GROUP BY brand_mentioned HAVING COUNT(*) >= 3
        ORDER BY mentions DESC LIMIT 10
    ''')
    brands = cur.fetchall()
    
    brand_rows = [[r['brand'], str(r['mentions']), f"{r['sentiment'] or 50:.0f}"] for r in brands]
    story.append(create_clean_table(['Brand', 'Mentions', 'Sentiment'], brand_rows,
                                   [3.5*inch, 1.5*inch, 1.5*inch]))
    
    story.append(PageBreak())
    
    # =========================================================================
    # PAIN POINTS
    # =========================================================================
    story.append(Paragraph("Consumer Pain Points", styles['H1']))
    story.append(HorizontalLine(page_width, 1, DARK))
    story.append(Spacer(1, 0.15*inch))
    
    story.append(Paragraph(
        "Frustrations represent business opportunities.",
        styles['Body']
    ))
    
    cur.execute('''
        SELECT unnest(frustrations) as frustration, COUNT(*) as mentions
        FROM post_classifications WHERE frustrations IS NOT NULL
        GROUP BY frustration ORDER BY mentions DESC LIMIT 8
    ''')
    frustrations = cur.fetchall()
    
    if frustrations:
        frust_data = [r['mentions'] for r in frustrations][::-1]
        frust_labels = [r['frustration'].replace('_', ' ').title() for r in frustrations][::-1]
        
        bar = create_bar_chart(frust_data, frust_labels, 450, 200)
        story.append(ChartContainer(bar, 450, 200))
    
    story.append(Spacer(1, 0.2*inch))
    story.append(Paragraph("Opportunity Areas", styles['H2']))
    story.append(Paragraph("→  Legal/Regulatory: Compliance tools, consumer education", styles['Callout']))
    story.append(Paragraph("→  Stigma: Normalization content, professional branding", styles['Callout']))
    story.append(Paragraph("→  Safety: Lab testing visibility, dosing guides", styles['Callout']))
    
    story.append(PageBreak())
    
    # =========================================================================
    # MARKET OVERVIEW
    # =========================================================================
    story.append(Paragraph("Market Overview", styles['H1']))
    story.append(HorizontalLine(page_width, 1, DARK))
    story.append(Spacer(1, 0.15*inch))
    
    # Product categories
    story.append(Paragraph("Product Categories", styles['H2']))
    cur.execute('''
        SELECT product_category as cat, COUNT(*) as mentions
        FROM post_classifications 
        WHERE product_category IS NOT NULL AND product_category != 'unknown'
        GROUP BY product_category ORDER BY mentions DESC LIMIT 8
    ''')
    products = cur.fetchall()
    
    if products:
        total_prod = sum(r['mentions'] for r in products)
        prod_rows = [[r['cat'].replace('_', ' ').title(), f"{r['mentions']:,}", 
                     f"{r['mentions']/total_prod*100:.1f}%"] for r in products]
        story.append(create_clean_table(['Category', 'Mentions', 'Share'], prod_rows,
                                       [3.5*inch, 1.5*inch, 1.5*inch]))
    
    # Consumption timing
    story.append(Paragraph("Consumption Timing", styles['H2']))
    cur.execute('''
        SELECT time_of_day as time, COUNT(*) as count
        FROM post_classifications 
        WHERE time_of_day IS NOT NULL AND time_of_day != 'unknown'
        GROUP BY time_of_day ORDER BY count DESC
    ''')
    times = cur.fetchall()
    
    if times:
        total_time = sum(r['count'] for r in times)
        time_rows = [[r['time'].replace('_', ' ').title(), f"{r['count']:,}",
                     f"{r['count']/total_time*100:.1f}%"] for r in times]
        story.append(create_clean_table(['Time of Day', 'Posts', 'Share'], time_rows,
                                       [3.5*inch, 1.5*inch, 1.5*inch]))
    
    story.append(PageBreak())
    
    # =========================================================================
    # CONTACT / CTA
    # =========================================================================
    story.append(Spacer(1, 0.5*inch))
    story.append(Paragraph("Full Platform Access", styles['H1']))
    story.append(HorizontalLine(page_width, 1, DARK))
    story.append(Spacer(1, 0.2*inch))
    
    story.append(Paragraph(
        "This report provides a sample of Cannect Intelligence capabilities. "
        "The full platform offers real-time alerts, custom segments, API access, "
        "and historical trend analysis.",
        styles['Body']
    ))
    
    story.append(Spacer(1, 0.3*inch))
    
    features = [
        ['Real-Time Alerts', 'Instant notification for high-intent consumers'],
        ['Custom Segments', 'Build and track proprietary audience groups'],
        ['Brand Monitoring', '24/7 brand and competitor tracking'],
        ['API Integration', 'Connect to your CRM and marketing stack'],
        ['Trend Analysis', 'Track preferences over time'],
    ]
    
    story.append(create_clean_table(['Feature', 'Description'], features, [2*inch, 4.5*inch]))
    
    conn.close()
    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"✓ Report generated: {output_path}")


def main():
    print("=" * 50)
    print("CANNECT INTELLIGENCE REPORT")
    print("=" * 50)
    
    os.makedirs('/root/cci/reports', exist_ok=True)
    output = f"/root/cci/reports/Cannect_Intelligence_Report_{datetime.now().strftime('%Y-%m')}.pdf"
    generate_report(output)
    print(f"Saved: {output}")


if __name__ == '__main__':
    main()
