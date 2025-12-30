# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously at Cannect. If you discover a security vulnerability,
please report it responsibly.

### How to Report

1. **Email**: Send details to security@cannect.space
2. **Subject**: Include "SECURITY" in the subject line
3. **Details**: Provide as much information as possible about the vulnerability

### What to Include

- Type of vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 7 days
- **Resolution**: Varies based on severity

### What to Expect

- We will acknowledge receipt of your report
- We will investigate and keep you informed of progress
- We will credit you (if desired) when the issue is resolved
- We will not take legal action against good-faith security researchers

### Scope

The following are in scope:
- cannect.net and cannect.nexus web applications
- cannect.space PDS server
- feed.cannect.space API
- push.cannect.space API

### Out of Scope

- Social engineering attacks
- Denial of service attacks
- Issues in third-party dependencies (report to the upstream project)

## Security Best Practices

This project follows security best practices:
- All secrets stored in environment variables
- No credentials committed to version control
- HTTPS enforced on all endpoints
- Regular dependency updates

Thank you for helping keep Cannect secure!
