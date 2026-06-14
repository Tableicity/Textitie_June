# Bottom Line for Go-Live

1. Create the tenant (signup or admin).
2. Make sure the number is in the platform's Twilio account, then assign it via admin
   Telephony (primary number).
3. **In Twilio, point the number's inbound webhook at
   `https://textitie.com/api/webhooks/twilio`.** ← the step the app won't do for you.
4. Send a test text both directions.
