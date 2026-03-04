Title: Orlena Critical Failure Modes

Overview
Orlena is a QR-based restaurant ordering system used in live dining environments.
Failures during ordering can directly impact restaurant revenue and customer experience.

The following system behaviors must remain reliable at all times.

Critical Flow 1: Menu Loading
When a customer scans the QR code, the menu must load reliably in the browser.

Failure risks to watch for:
API failures when fetching menu data
Slow database queries
Frontend crashes during menu rendering
Network timeouts

Impact if broken:
Customers cannot browse or order food.

Critical Flow 2: Checkout Flow
The checkout modal is the final step before placing an order.

Failure risks to watch for:
Frontend state crashes
Cart data corruption
Missing validation for order payload
Backend request failures

Impact if broken:
Customers cannot complete orders.

Critical Flow 3: Upsell Ranking
The system calls the OpenAI API to rank upsell candidates.

Endpoint:
/api/rank-upsell

Failure risks to watch for:
OpenAI API timeouts
Unhandled promise rejections
Invalid JSON responses from GPT
Missing try/catch around async calls

Impact if broken:
Upsell feature fails or crashes checkout.

Critical Flow 4: Order Submission
When checkout completes, the order must be stored reliably.

Failure risks to watch for:
Database insert failures
Missing error handling on Postgres queries
Unhandled async errors
Request timeouts

Impact if broken:
Orders may be lost or not recorded.

Reliability Expectations for Code Review
AI code reviewers should prioritize identifying:

runtime crashes
unhandled promise rejections
missing try/catch blocks
database query failures
OpenAI API failure handling
timeout risks

Any change that introduces risk to these flows should be flagged during code review.
