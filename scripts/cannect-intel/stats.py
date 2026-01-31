#!/usr/bin/env python3
"""Quick stats viewer"""
import sqlite3

conn = sqlite3.connect('/root/cannect-intel/insights.db')
c = conn.cursor()

print("=" * 60)
print("CANNECT INTELLIGENCE - CURRENT INSIGHTS")
print("=" * 60)

c.execute('SELECT COUNT(*) FROM insights')
total = c.fetchone()[0]
print(f"\nTotal Posts Analyzed: {total}")

print("\n" + "=" * 60)
print("MOOD BREAKDOWN")
print("=" * 60)
c.execute('SELECT mood, COUNT(*) FROM insights GROUP BY mood ORDER BY COUNT(*) DESC LIMIT 15')
for row in c.fetchall():
    mood = row[0] if row[0] else "(not detected)"
    print(f"  {row[1]:4} | {mood}")

print("\n" + "=" * 60)
print("PRODUCTS/STRAINS MENTIONED")
print("=" * 60)
c.execute('SELECT product, COUNT(*) FROM insights WHERE product IS NOT NULL GROUP BY product ORDER BY COUNT(*) DESC LIMIT 30')
for row in c.fetchall():
    if row[0] and row[0].lower() not in ['null', 'no product', 'none', '']:
        print(f"  {row[1]:4} | {row[0]}")

print("\n" + "=" * 60)
print("LOCATIONS MENTIONED")
print("=" * 60)
c.execute('SELECT location, COUNT(*) FROM insights WHERE location IS NOT NULL GROUP BY location ORDER BY COUNT(*) DESC LIMIT 25')
for row in c.fetchall():
    if row[0] and row[0].lower() not in ['null', 'none', '']:
        print(f"  {row[1]:4} | {row[0]}")

print("\n" + "=" * 60)
print("POST TYPES")
print("=" * 60)
c.execute('SELECT post_type, COUNT(*) FROM insights GROUP BY post_type ORDER BY COUNT(*) DESC')
for row in c.fetchall():
    ptype = row[0] if row[0] else "(not classified)"
    print(f"  {row[1]:4} | {ptype}")

print("\n" + "=" * 60)
print("SAMPLE POSTS WITH PRODUCTS")
print("=" * 60)
c.execute('''SELECT product, mood, substr(post_text, 1, 80) 
             FROM insights 
             WHERE product IS NOT NULL 
             AND product NOT IN ('null', 'no product', 'None', '') 
             LIMIT 10''')
for row in c.fetchall():
    print(f"\n  Product: {row[0]}")
    print(f"  Mood: {row[1]}")
    print(f"  Text: {row[2]}...")

conn.close()
