Title: Orlena System Architecture

System Overview
Orlena is a QR-based restaurant ordering system where customers scan a QR code at a table, browse the menu, add items to cart, and place an order.
An AI upsell engine recommends additional items during checkout to increase order value.

Technology Stack
Frontend: React + Vite deployed on Vercel
Backend: Node.js with Express deployed on Render
Database: Postgres
AI: OpenAI GPT used for upsell ranking and persuasive copy generation

Core Customer Flow

1. Customer scans QR code at table
2. Menu loads in the browser
3. Customer adds items to cart
4. Backend ranks upsell candidates using GPT
5. A single upsell recommendation appears during checkout
6. Customer can accept or reject the upsell
7. Order is finalized

Critical Backend API Endpoints
/api/rank-upsell
Ranks upsell candidates using OpenAI GPT and returns the best recommendation.

/api/upsell-event
Stores analytics events related to upsell performance such as shown, accepted, or rejected.

Critical Product Flow
Checkout flow
The checkout modal triggers upsell ranking and displays a single recommended item before order confirmation.

Analytics Tracking
Upsell interactions are stored in a Postgres table called upsell_events.

Fields stored:
restaurant_slug
table_number
item_id
cart_value
upsell_value
event_type
gpt_word_count
upsell_reason
created_at

Reliability Requirements
This system runs in a live restaurant environment.
Failures during checkout or upsell ranking must never block the ordering flow.

Code reviewers should prioritize:

runtime crash risks
missing try/catch around async code
OpenAI API failure handling
database query failure handling
unhandled promise rejections
timeouts or blocking calls
