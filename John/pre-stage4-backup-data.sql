--
-- PostgreSQL database dump
--

\restrict JzAXpdJIt0N6owavOwSMNwjABwISihUdn8uJQ37vkXx88IkE5ANhWcVav6Hp1db

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: tenants; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tenants (id, slug, name, region, tier_code, sovereign_toggle, created_at, phone_number, chatwoot_account_id, chatwoot_inbox_id, knowledge_base, stripe_customer_id, stripe_subscription_id, subscription_status, plan_tier_code, trial_ends_at, current_period_start, current_period_end, trial_used, prepaid_credits, overage_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_tz, frequency_cap_per_day, require_double_opt_in, hipaa_enabled, baa_acknowledged_at, baa_acknowledged_by) FROM stdin;
2	orbital	Orbital Logistics	EE	growth	f	2026-05-03 05:32:57.144017+00	+37212345678	1	2	\N	\N	\N	none	\N	\N	\N	\N	f	0	f	\N	\N	America/New_York	0	f	f	\N	\N
3	helvetia	Helvetia Privatbank	DE	enterprise	t	2026-05-03 05:32:57.144017+00	+4915110009999	1	3	\N	\N	\N	none	\N	\N	\N	\N	f	0	f	\N	\N	America/New_York	0	f	f	\N	\N
4	orbital-test	Orbital Test GmbH	EE	growth	f	2026-05-04 02:21:39.010046+00	\N	1	2	\N	\N	\N	none	\N	\N	\N	\N	f	0	f	\N	\N	America/New_York	0	f	f	\N	\N
1	acme	ACME Corp	DE	starter	f	2026-05-03 05:32:57.144017+00	+19094904265	1	1	Q: Hours? A: 24/7 sovereign uplink.\nQ: Refunds? A: 14 days, no questions.\nESCALATE if: customer mentions lawyer or fraud.\n\n--- Uploaded from: orbital_kb.txt ---\n\nQ: What is Orbital's main product?\nA: Satellite imagery for agriculture.\n\nQ: Pricing?\nA: Starting at 500 EUR/month.\n\n--- Uploaded from: test_kb.txt ---\n\nTest knowledge base content for verification.\n\n--- Uploaded from: normal.txt ---\n\nNormal upload test	cus_stub_demo_acme	sub_stub_demo_acme	trialing	starter	2026-05-18 07:47:04.88+00	2026-05-01 00:00:00+00	2026-05-31 23:59:59.999+00	f	4996	f	\N	\N	America/New_York	0	f	f	\N	\N
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_logs (id, tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, before_json, after_json, ip, user_agent, created_at) FROM stdin;
1	1	2	abc17@gmail.com	tenant.settings_updated	tenant	1	{"id": 1, "name": "ACME Corp", "slug": "acme", "tierCode": "starter", "hipaaEnabled": false, "quietHoursTz": "America/New_York", "hipaaEligible": false, "quietHoursEnd": null, "quietHoursStart": null, "baaAcknowledgedAt": null, "baaAcknowledgedBy": null, "frequencyCapPerDay": 0, "requireDoubleOptIn": false}	{"id": 1, "name": "ACME Corp", "slug": "acme", "tierCode": "starter", "hipaaEnabled": false, "quietHoursTz": "America/New_York", "hipaaEligible": false, "quietHoursEnd": 8, "quietHoursStart": 21, "baaAcknowledgedAt": null, "baaAcknowledgedBy": null, "frequencyCapPerDay": 3, "requireDoubleOptIn": true}	127.0.0.1	curl/8.14.1	2026-05-04 23:10:16.881479+00
2	1	2	abc17@gmail.com	opt_in.recorded	opt_in	1	\N	{"phone": "+14155555678", "source": "agent_collected"}	127.0.0.1	curl/8.14.1	2026-05-04 23:10:17.010657+00
3	1	2	abc17@gmail.com	integration.connected	integration	1	\N	{"provider": "hubspot", "displayName": "hubspot (Stub)"}	127.0.0.1	curl/8.14.1	2026-05-04 23:10:17.347054+00
4	1	2	abc17@gmail.com	tenant.settings_updated	tenant	1	{"id": 1, "name": "ACME Corp", "slug": "acme", "tierCode": "starter", "hipaaEnabled": false, "quietHoursTz": "America/New_York", "hipaaEligible": false, "quietHoursEnd": 8, "quietHoursStart": 21, "baaAcknowledgedAt": null, "baaAcknowledgedBy": null, "frequencyCapPerDay": 3, "requireDoubleOptIn": true}	{"id": 1, "name": "ACME Corp", "slug": "acme", "tierCode": "starter", "hipaaEnabled": false, "quietHoursTz": "America/New_York", "hipaaEligible": false, "quietHoursEnd": 23, "quietHoursStart": 0, "baaAcknowledgedAt": null, "baaAcknowledgedBy": null, "frequencyCapPerDay": 3, "requireDoubleOptIn": false}	127.0.0.1	curl/8.14.1	2026-05-04 23:10:37.834845+00
5	1	2	abc17@gmail.com	tenant.settings_updated	tenant	1	{"id": 1, "name": "ACME Corp", "slug": "acme", "tierCode": "starter", "hipaaEnabled": false, "quietHoursTz": "America/New_York", "hipaaEligible": false, "quietHoursEnd": 23, "quietHoursStart": 0, "baaAcknowledgedAt": null, "baaAcknowledgedBy": null, "frequencyCapPerDay": 3, "requireDoubleOptIn": false}	{"id": 1, "name": "ACME Corp", "slug": "acme", "tierCode": "starter", "hipaaEnabled": false, "quietHoursTz": "America/New_York", "hipaaEligible": false, "quietHoursEnd": null, "quietHoursStart": null, "baaAcknowledgedAt": null, "baaAcknowledgedBy": null, "frequencyCapPerDay": 0, "requireDoubleOptIn": false}	127.0.0.1	curl/8.14.1	2026-05-04 23:10:37.935488+00
6	1	2	abc17@gmail.com	integration.resync_triggered	integration	hubspot	\N	{"enqueued": 2}	127.0.0.1	curl/8.14.1	2026-05-04 23:10:40.267343+00
7	1	2	abc17@gmail.com	survey.updated	survey	1	{"enabled": false, "sendAfterClose": true}	{"enabled": true, "sendAfterClose": true}	127.0.0.1	curl/8.14.1	2026-05-05 00:14:44.910882+00
8	1	2	abc17@gmail.com	conversation.resolved	conversation	2	{"status": "open", "dispositionId": null, "resolutionNote": null}	{"status": "closed", "dispositionId": null, "resolutionNote": "survey test"}	127.0.0.1	curl/8.14.1	2026-05-05 00:15:00.022661+00
9	1	2	abc17@gmail.com	conversation.updated	conversation	1	{"status": "open", "dispositionId": 1, "resolutionNote": "All sorted"}	{"status": "open", "dispositionId": 1, "resolutionNote": "All sorted"}	127.0.0.1	curl/8.14.1	2026-05-05 00:19:54.671233+00
10	1	2	abc17@gmail.com	conversation.resolved	conversation	1	{"status": "open", "dispositionId": 1, "resolutionNote": "All sorted"}	{"status": "closed", "dispositionId": 1, "resolutionNote": "v2 test"}	127.0.0.1	curl/8.14.1	2026-05-05 00:19:54.734098+00
11	1	2	abc17@gmail.com	conversation.created	conversation	7	\N	{"contactName": "Smoke Test", "contactPhone": "+15555550199", "departmentId": null}	34.82.187.200	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2026-05-05 01:19:48.51451+00
12	1	2	abc17@gmail.com	contact.updated	contact	2	{"id": 2, "name": "Smoke Test", "tags": null, "email": null, "notes": null, "phone": "+15555550199", "location": null, "tenantId": 1, "createdAt": "2026-05-05T01:19:48.476Z", "updatedAt": "2026-05-05T01:20:41.373Z", "firstSeenAt": "2026-05-05T01:19:48.476Z", "lastInteractionAt": null}	{"id": 2, "name": "Smoke Test", "tags": null, "email": null, "notes": null, "phone": "+15555550199", "location": null, "tenantId": 1, "createdAt": "2026-05-05T01:19:48.476Z", "updatedAt": "2026-05-05T01:21:04.747Z", "firstSeenAt": "2026-05-05T01:19:48.476Z", "lastInteractionAt": null}	34.82.187.200	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2026-05-05 01:21:04.754833+00
13	1	2	abc17@gmail.com	contact.updated	contact	2	{"id": 2, "name": "Smoke Test 2", "tags": null, "email": null, "notes": null, "phone": "+15555550199", "location": null, "tenantId": 1, "createdAt": "2026-05-05T01:19:48.476Z", "updatedAt": "2026-05-05T01:24:25.319Z", "firstSeenAt": "2026-05-05T01:19:48.476Z", "lastInteractionAt": null}	{"id": 2, "name": "Smoke Test 2", "tags": null, "email": null, "notes": null, "phone": "+15555550199", "location": null, "tenantId": 1, "createdAt": "2026-05-05T01:19:48.476Z", "updatedAt": "2026-05-05T01:24:47.737Z", "firstSeenAt": "2026-05-05T01:19:48.476Z", "lastInteractionAt": null}	34.82.187.200	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2026-05-05 01:24:47.744154+00
14	1	2	abc17@gmail.com	contact.updated	contact	2	{"id": 2, "name": "Smoke Test 2", "tags": null, "email": null, "notes": null, "phone": "+15555550199", "location": null, "tenantId": 1, "createdAt": "2026-05-05T01:19:48.476Z", "updatedAt": "2026-05-05T01:24:47.737Z", "firstSeenAt": "2026-05-05T01:19:48.476Z", "lastInteractionAt": null}	{"id": 2, "name": "Smoke Test 2", "tags": null, "email": null, "notes": null, "phone": "+15555550199", "location": "Granada Hills, California, US", "tenantId": 1, "createdAt": "2026-05-05T01:19:48.476Z", "updatedAt": "2026-05-05T01:28:31.232Z", "firstSeenAt": "2026-05-05T01:19:48.476Z", "lastInteractionAt": null}	34.82.187.200	Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36	2026-05-05 01:28:31.252779+00
\.


--
-- Data for Name: automation_rules; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.automation_rules (id, tenant_id, type, name, enabled, trigger_config, action_config, priority, created_at, updated_at) FROM stdin;
1	1	welcome_message	Welcome New Contacts	t	{}	{"replyBody": "Welcome to ACME Corp! How can we help you today? A team member will be with you shortly."}	0	2026-05-04 18:11:39.574655+00	2026-05-04 18:11:39.574655+00
2	1	keyword_reply	Hours & Availability	t	{"keywords": ["hours", "open", "available", "schedule"], "matchType": "contains"}	{"replyBody": "Our business hours are Monday–Friday, 9 AM – 6 PM EST. We typically respond within 15 minutes during business hours."}	10	2026-05-04 18:11:39.85174+00	2026-05-04 18:11:39.85174+00
3	1	keyword_reply	Pricing Info	t	{"keywords": ["price", "pricing", "cost", "how much"], "matchType": "contains"}	{"replyBody": "Thanks for your interest in pricing! Our plans start at $29/mo. Visit our website for full details, or I can connect you with our sales team."}	20	2026-05-04 18:11:39.856155+00	2026-05-04 18:11:39.856155+00
4	1	follow_up_timer	24h Follow-up	t	{"inactiveHours": 24}	{"replyBody": "Hi! Just checking in — is there anything else we can help you with?"}	0	2026-05-04 18:11:39.861439+00	2026-05-04 18:11:39.861439+00
5	1	auto_resolve	Auto-close after 72h	t	{"inactiveHours": 72}	{"replyBody": "This conversation has been closed due to inactivity. Feel free to message us anytime if you need help!"}	0	2026-05-04 18:11:39.865719+00	2026-05-04 18:11:39.865719+00
6	1	auto_unsubscribe	TCPA Opt-out	t	{}	{}	-1	2026-05-04 18:11:39.86972+00	2026-05-04 18:11:39.86972+00
\.


--
-- Data for Name: billing_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.billing_events (id, tenant_id, event_type, from_tier, to_tier, amount_cents, metadata, created_at) FROM stdin;
16	1	trial_started	\N	starter	2900	{"subscriptionId":"sub_stub_demo_acme","trialDays":14}	2026-05-04 07:47:04.885866+00
\.


--
-- Data for Name: campaigns; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.campaigns (id, tenant_id, name, body, status, segment_filter, total_recipients, queued_count, sent_count, delivered_count, failed_count, response_count, opt_out_count, credits_required, created_by, created_at, scheduled_at, started_at, completed_at) FROM stdin;
1	1	Test Holiday Campaign	Hi {{first_name}}, check out our holiday deals!	draft	{"tags": ["vip"]}	2	0	0	0	0	0	0	2	2	2026-05-04 19:16:52.957068+00	\N	\N	\N
2	1	Race condition test	Hi {{first_name}}, test!	draft	{"tags": ["vip"]}	2	0	0	0	0	0	0	2	2	2026-05-04 19:20:32.691092+00	\N	\N	\N
3	1	Phase6 Smoke	Hi {{first_name}}, smoke test	completed	{"tags": ["vip"]}	2	2	2	2	0	1	1	2	2	2026-05-04 20:41:06.203811+00	\N	2026-05-04 20:41:06.510038+00	2026-05-04 20:41:08.145444+00
6	1	Reschedule Test	x	draft	{"tags": ["vip"]}	1	0	0	0	0	0	0	1	2	2026-05-04 20:42:37.812081+00	\N	\N	\N
4	1	Sched Test	Auto-fire test	completed	{"tags": ["vip"]}	1	1	1	0	0	0	0	1	2	2026-05-04 20:41:56.799384+00	2026-05-04 20:39:56.748+00	2026-05-04 20:43:20.346468+00	2026-05-04 20:43:21.674542+00
5	1	Reschedule Test	x	completed	{"tags": ["vip"]}	1	1	1	0	0	0	0	1	2	2026-05-04 20:41:57.053046+00	2026-05-04 21:41:57.007+00	2026-05-04 21:42:35.019411+00	2026-05-04 21:42:36.414088+00
\.


--
-- Data for Name: departments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.departments (id, tenant_id, name, phone_number, twilio_sid, description, created_at, routing_strategy) FROM stdin;
2	1	Sales	\N	\N	Sales and outreach team	2026-05-04 05:47:19.957666+00	round_robin
3	1	Marketing	\N	\N	Marketing campaigns	2026-05-04 05:57:50.431235+00	round_robin
1	1	Customer Support	\N	\N	Main support team	2026-05-04 05:47:19.855177+00	load_balanced
\.


--
-- Data for Name: tenant_users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tenant_users (id, tenant_id, email, password_hash, name, role, created_at, status, skills, languages, last_assigned_at) FROM stdin;
1	1	agent@acme.test	b09c1e974a49588210c08d7e96f9ca6f:0096f7927386d729718c3a898dc336e244b809c1b446d0a17a0c586cc47f1e8c50c3f0c7d420af85746ed27b8d164c17bfa68b1799b7d1cdd92585d6380ec973	ACME Agent	agent	2026-05-04 05:07:46.056526+00	offline	\N	\N	\N
2	1	abc17@gmail.com	94930c46b86a556608cb36d3c76fe479:227488c6d15899686caeab2ccf64a372b065c1676147e2bc8f99f872220ffcc2790f5811defcf8b2a80d0072e560239ccf8f7bb01a5ad522299ac7b26c6014ac	Admin User	admin	2026-05-04 05:30:10.566067+00	online	\N	\N	2026-05-04 06:34:39.069+00
\.


--
-- Data for Name: conversations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.conversations (id, tenant_id, contact_phone, contact_name, status, assigned_user_id, last_message_at, created_at, department_id, assigned_at, tags, contact_id, disposition_id, resolution_note) FROM stdin;
3	1	+14155559012	Emily Davis	closed	\N	2026-05-04 04:08:37.159+00	2026-05-04 03:08:37.159+00	\N	\N	{resolved}	\N	\N	\N
5	1	+14155557890	Lisa Park	open	\N	2026-05-04 07:46:33.502+00	2026-05-04 07:46:33.503011+00	\N	\N	{sales,prospect}	\N	\N	\N
6	1	+14155552468	Robert Martinez	open	\N	2026-05-04 07:46:33.516+00	2026-05-04 07:46:33.516829+00	\N	\N	{enterprise,support}	\N	\N	\N
4	1	+14155553456	=SUM(1+1)	open	\N	2026-05-04 20:41:36.314+00	2026-05-04 07:46:33.451463+00	\N	\N	{vip,sales}	\N	\N	\N
2	1	+14155555678	Mike Chen	closed	\N	2026-05-04 23:10:37.65+00	2026-05-04 03:08:37.159+00	\N	\N	{orders,support}	\N	\N	survey test
1	1	+14155551234	Sarah Johnson	closed	\N	2026-05-04 20:41:36.608+00	2026-05-04 03:08:37.159+00	\N	\N	{vip,support}	\N	1	v2 test
7	1	+15555550199	Smoke Test	open	\N	\N	2026-05-05 01:19:48.510266+00	\N	\N	\N	2	\N	\N
\.


--
-- Data for Name: campaign_messages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.campaign_messages (id, campaign_id, conversation_id, contact_phone, contact_name, rendered_body, status, sent_at, error_message, external_id, delivered_at, responded_at) FROM stdin;
2	3	1	+14155551234	Sarah Johnson	Hi Sarah, smoke test	delivered	2026-05-04 20:41:07.132006+00	\N	SMe817647743bddc022f13c28fedb21618	2026-05-04 20:41:35.925366+00	\N
1	3	4	+14155553456	James Wilson	Hi James, smoke test	delivered	2026-05-04 20:41:06.932961+00	\N	SM8ffdb6d089cb1aecf44c4b69400215ae	2026-05-04 20:41:35.718038+00	2026-05-04 20:41:36.321382+00
3	4	4	+14155553456	James Wilson	Auto-fire test	sent	2026-05-04 20:43:20.651881+00	\N	SM4b2cc3e38986897a8712475a7281fb84	\N	\N
4	5	4	+14155553456	=SUM(1+1)	x	sent	2026-05-04 21:42:35.399607+00	\N	SM923b1d81e959ec769a666ccf0e9a6945	\N	\N
\.


--
-- Data for Name: contacts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.contacts (id, tenant_id, phone, name, email, notes, tags, first_seen_at, last_interaction_at, created_at, updated_at, location) FROM stdin;
1	1	+15559998888	Test User	t@t.com	test	{vip,lead}	2026-05-04 22:05:07.70175+00	\N	2026-05-04 22:05:07.70175+00	2026-05-04 22:05:07.70175+00	\N
2	1	+15555550199	Smoke Test 2	\N	\N	\N	2026-05-05 01:19:48.476954+00	\N	2026-05-05 01:19:48.476954+00	2026-05-05 01:29:00.187+00	Granada Hills, California, US
\.


--
-- Data for Name: conversation_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.conversation_events (id, conversation_id, event_type, actor_id, target_id, note, metadata, created_at) FROM stdin;
1	1	claimed	2	\N	\N	\N	2026-05-04 06:32:41.615328+00
2	1	unassigned	2	\N	\N	\N	2026-05-04 06:32:41.776814+00
3	1	claimed	2	\N	\N	\N	2026-05-04 06:34:39.168371+00
4	1	unassigned	2	\N	\N	\N	2026-05-04 06:34:44.087742+00
5	1	auto_unsubscribed	\N	\N	Contact sent "stop" — TCPA opt-out processed	\N	2026-05-04 20:41:36.610896+00
6	2	resolved	2	\N	\N	{"dispositionId":null,"resolutionNote":"survey test"}	2026-05-05 00:15:00.003196+00
7	1	resolved	2	\N	\N	{"dispositionId":1,"resolutionNote":"v2 test"}	2026-05-05 00:19:54.723135+00
\.


--
-- Data for Name: crm_sync_queue; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.crm_sync_queue (id, tenant_id, provider, entity_type, entity_id, op, payload_json, status, attempts, last_error, external_id, next_attempt_at, created_at, updated_at) FROM stdin;
1	1	hubspot	contact	1	upsert	{"tags": ["vip", "lead"], "email": "t@t.com", "phone": "+15559998888", "lastName": "User", "firstName": "Test"}	done	1	\N	stub_hs_contact_2b3135353539	2026-05-04 23:10:40.258027+00	2026-05-04 23:10:40.258027+00	2026-05-04 23:11:06.191+00
2	1	hubspot	conversation	3	log_activity	{"body": "Conversation #3 resolved. Disposition: n/a. Note: ", "metadata": {"disposition": null, "conversationId": 3}, "externalContactId": "phone:+14155559012"}	done	1	\N	stub_hs_engagement_1777936266255_1rf73a	2026-05-04 23:10:40.263815+00	2026-05-04 23:10:40.263815+00	2026-05-04 23:11:06.255+00
3	1	hubspot	conversation	2	log_activity	{"body": "Conversation #2 resolved. Disposition: n/a. Note: survey test", "metadata": {"disposition": null, "conversationId": 2}, "externalContactId": "phone:+14155555678"}	done	1	\N	stub_hs_engagement_1777940131135_p1y4rl	2026-05-05 00:15:00.011796+00	2026-05-05 00:15:00.011796+00	2026-05-05 00:15:31.135+00
4	1	hubspot	conversation	1	log_activity	{"body": "Conversation #1 resolved. Disposition: Resolved. Note: v2 test", "metadata": {"disposition": "Resolved", "conversationId": 1}, "externalContactId": "phone:+14155551234"}	done	1	\N	stub_hs_engagement_1777940441675_bfvxm9	2026-05-05 00:19:54.728485+00	2026-05-05 00:19:54.728485+00	2026-05-05 00:20:41.676+00
5	1	hubspot	contact	2	upsert	{"tags": [], "email": null, "phone": "+15555550199", "lastName": "Test", "firstName": "Smoke"}	done	1	\N	stub_hs_contact_2b3135353535	2026-05-05 01:21:04.770782+00	2026-05-05 01:21:04.770782+00	2026-05-05 01:22:30.647+00
6	1	hubspot	contact	2	upsert	{"tags": [], "email": null, "phone": "+15555550199", "lastName": "Test 2", "firstName": "Smoke"}	done	1	\N	stub_hs_contact_2b3135353535	2026-05-05 01:24:47.750038+00	2026-05-05 01:24:47.750038+00	2026-05-05 01:26:23.107+00
7	1	hubspot	contact	2	upsert	{"tags": [], "email": null, "phone": "+15555550199", "lastName": "Test 2", "firstName": "Smoke"}	done	1	\N	stub_hs_contact_2b3135353535	2026-05-05 01:28:31.267436+00	2026-05-05 01:28:31.267436+00	2026-05-05 01:28:49.514+00
\.


--
-- Data for Name: department_members; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.department_members (id, department_id, tenant_user_id, created_at) FROM stdin;
1	1	2	2026-05-04 05:47:20.136583+00
\.


--
-- Data for Name: dispositions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.dispositions (id, tenant_id, label, color, sort_order, archived, created_at) FROM stdin;
1	1	Resolved	#10b981	0	f	2026-05-04 22:05:07.211528+00
\.


--
-- Data for Name: email_verifications; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.email_verifications (id, tenant_user_id, code_hash, expires_at, attempts, used, created_at) FROM stdin;
1	2	87438b4260dc91a1230587879d509c4ccde6b9a384b4a0594a06b8cf04a208e1	2026-05-05 05:14:20.195+00	0	t	2026-05-05 05:04:20.196513+00
4	2	61551cd0123b40c63067beb1300ad1e76690c883b531df26ef554c6d86376701	2026-05-05 05:28:58.973+00	0	f	2026-05-05 05:18:58.975925+00
\.


--
-- Data for Name: injections; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.injections (id, tenant_id, to_number, body, status, response_summary, conductor_authorized, created_at) FROM stdin;
1	1	+4915110001234	Hello from Conductor — Gate 1 smoke test	stubbed	Stubbed: N8N_WEBHOOK_URL not configured — Gate 1 plumbing only	t	2026-05-03 05:36:42.790419+00
2	\N	+15555550199	E2E test from Playwright	stubbed	Stubbed: N8N_WEBHOOK_URL not configured — Gate 1 plumbing only	t	2026-05-03 05:38:49.509605+00
3	1	+15005550001	Gate 2 wire test (Twilio magic invalid-number)	sent	Twilio sid=SM818d5f7335cc26c26bf60a30f12fcd89 status=queued	t	2026-05-03 09:27:14.332145+00
4	1	+15005550006	Re-verify Twilio wire after SAMA_FROM_NUMBER update	sent	Twilio sid=SM78fdae030611001c2a842b5645203481 status=queued	t	2026-05-03 09:32:41.196074+00
5	1	+15005550006	Gate 3 inject as Acme tenant	sent	Twilio sid=SM284c5a3058442f6378061dc6696d9790 status=queued from=+19094904265	t	2026-05-03 09:39:33.478783+00
\.


--
-- Data for Name: integrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.integrations (id, tenant_id, provider, status, display_name, config_json, settings_json, connected_at, last_sync_at, last_error, created_at, updated_at) FROM stdin;
1	1	hubspot	connected	hubspot (Stub)	{"mode": "stub"}	{}	2026-05-04 23:10:17.337+00	2026-05-05 01:28:49.535+00	\N	2026-05-04 23:10:17.338774+00	2026-05-05 01:28:49.535+00
\.


--
-- Data for Name: message_templates; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.message_templates (id, tenant_id, name, shortcut_key, body, category, created_by, created_at, updated_at) FROM stdin;
1	1	Greeting	/hello	Hi there! Thanks for reaching out to ACME Corp. How can I help you today?	General	\N	2026-05-04 18:11:39.873428+00	2026-05-04 18:11:39.873428+00
2	1	Transfer Notice	/transfer	I'm going to transfer you to a specialist who can better assist you. One moment please!	General	\N	2026-05-04 18:11:39.878174+00	2026-05-04 18:11:39.878174+00
3	1	Business Hours	/hours	Our business hours are Monday–Friday, 9 AM – 6 PM EST. We typically respond within 15 minutes during business hours.	Info	\N	2026-05-04 18:11:39.881863+00	2026-05-04 18:11:39.881863+00
4	1	Closing	/bye	Thanks for contacting ACME Corp! Don't hesitate to reach out if you need anything else. Have a great day!	General	\N	2026-05-04 18:11:39.943383+00	2026-05-04 18:11:39.943383+00
5	1	Escalation	/escalate	I understand this is important. Let me escalate this to our senior team right away. You'll hear back within the hour.	Support	\N	2026-05-04 18:11:39.947119+00	2026-05-04 18:11:39.947119+00
6	1	Order Status	/order	I'd be happy to look into your order status. Could you please share your order number?	Support	\N	2026-05-04 18:11:39.95144+00	2026-05-04 18:11:39.95144+00
7	1	Refund Policy	/refund	Our refund policy allows returns within 30 days of purchase. Would you like me to initiate a refund for you?	Support	\N	2026-05-04 18:11:39.955436+00	2026-05-04 18:11:39.955436+00
\.


--
-- Data for Name: messages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.messages (id, conversation_id, direction, body, sender_name, read, created_at) FROM stdin;
1	1	inbound	Hi, I need help with my account settings	Sarah Johnson	t	2026-05-04 03:08:37.159+00
2	1	outbound	Of course! What specifically do you need help with?	agent@acme.test	t	2026-05-04 04:08:37.159+00
3	1	inbound	I want to change my notification preferences	Sarah Johnson	f	2026-05-04 05:03:37.159+00
4	2	inbound	When will my order ship?	Mike Chen	t	2026-05-04 03:08:37.159+00
5	2	outbound	Let me check that for you. What is your order number?	agent@acme.test	t	2026-05-04 04:08:37.159+00
6	2	inbound	Order #12345	Mike Chen	f	2026-05-04 04:58:37.159+00
7	3	inbound	Thanks for the help!	Emily Davis	t	2026-05-04 03:08:37.159+00
8	3	outbound	You are welcome! Feel free to reach out anytime.	agent@acme.test	t	2026-05-04 04:08:37.159+00
9	1	outbound	Test reply from API	agent@acme.test	t	2026-05-04 05:12:23.413097+00
10	1	outbound	Testing reply!	agent@acme.test	t	2026-05-04 05:19:17.574274+00
11	4	inbound	I'd like to upgrade my subscription plan	James Wilson	f	2026-05-04 07:41:33.45+00
12	4	outbound	Great choice! Let me walk you through our available plans.	Admin User	t	2026-05-04 07:42:33.45+00
13	4	inbound	What's included in the Growth plan?	James Wilson	f	2026-05-04 07:43:33.45+00
14	4	outbound	The Growth plan includes 5,000 credits/month, up to 10 agents, 5 dedicated phone numbers, and priority support. It's $79/month.	Admin User	t	2026-05-04 07:44:33.45+00
15	4	inbound	That sounds perfect for our team. How do I switch?	James Wilson	f	2026-05-04 07:45:33.45+00
16	5	inbound	Hello! I saw your ad on Instagram and wanted to learn more	Lisa Park	f	2026-05-04 07:43:33.502+00
17	5	outbound	Welcome Lisa! What product are you interested in?	ACME Agent	t	2026-05-04 07:44:33.502+00
18	5	inbound	I'm looking for a messaging solution for my small business — about 5 employees	Lisa Park	f	2026-05-04 07:45:33.502+00
19	6	inbound	We've been having issues with message delivery to German numbers	Robert Martinez	f	2026-05-04 07:42:33.516+00
20	6	outbound	I can help with that. Are you using our sovereign DE routing?	Admin User	t	2026-05-04 07:43:33.516+00
21	6	inbound	No, we haven't set that up yet. How does it work?	Robert Martinez	f	2026-05-04 07:44:33.516+00
22	6	outbound	With the Enterprise plan, you can enable the Sovereign Toggle which routes all messages through DE-resident infrastructure. This ensures GDPR compliance and better delivery rates to European numbers.	Admin User	t	2026-05-04 07:45:33.516+00
23	4	inbound	Sounds great, tell me more!	+14155553456	f	2026-05-04 20:41:36.306519+00
24	1	inbound	STOP	+14155551234	f	2026-05-04 20:41:36.585466+00
25	1	outbound	You have been unsubscribed and will no longer receive messages from us. Reply START to re-subscribe.	System (Auto)	t	2026-05-04 20:41:36.604324+00
26	1	internal	Internal note for the team.	abc17@gmail.com	t	2026-05-04 22:05:08.231308+00
27	2	outbound	Hello opted in user	abc17@gmail.com	t	2026-05-04 23:10:37.650695+00
\.


--
-- Data for Name: opt_ins; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.opt_ins (id, tenant_id, phone, source, consented_at, ip, user_agent, evidence_url, note, revoked_at) FROM stdin;
1	1	+14155555678	agent_collected	2026-05-04 23:10:16.992171+00	127.0.0.1	curl/8.14.1	\N	\N	\N
\.


--
-- Data for Name: opt_outs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.opt_outs (id, tenant_id, phone_number, reason, opted_out_at, campaign_id) FROM stdin;
1	1	+14155551234	Keyword: stop	2026-05-04 20:41:36.59475+00	3
\.


--
-- Data for Name: reminders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.reminders (id, tenant_id, conversation_id, user_id, remind_at, note, fired_at, dismissed_at, created_at) FROM stdin;
1	1	1	2	2026-05-04 23:05:08+00	follow up	2026-05-04 23:05:42.507+00	\N	2026-05-04 22:05:08.392494+00
\.


--
-- Data for Name: surveys; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.surveys (id, tenant_id, type, enabled, prompt, thank_you, send_after_close, send_delay_minutes, created_at, updated_at) FROM stdin;
1	1	csat	t	How would you rate your experience? Please tap the link to leave a rating:	Thanks for your feedback!	t	0	2026-05-05 00:14:44.854073+00	2026-05-05 00:14:44.906+00
\.


--
-- Data for Name: survey_sends; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.survey_sends (id, tenant_id, survey_id, conversation_id, contact_phone, token, sent_at, expires_at, status, error, created_at) FROM stdin;
1	1	1	2	+14155555678	vylrXUPBQ0IKA23qtiRNSIwc	\N	2026-05-19 00:15:00.018+00	responded	\N	2026-05-05 00:15:00.018956+00
\.


--
-- Data for Name: survey_responses; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.survey_responses (id, tenant_id, send_id, score, comment, responded_at, ip, user_agent) FROM stdin;
1	1	1	5	Great service	2026-05-05 00:15:00.722541+00	127.0.0.1	curl/8.14.1
\.


--
-- Data for Name: tiers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tiers (id, code, name, description, features, monthly_price_cents, included_credits, trial_days, max_agents, max_phone_numbers, hipaa_eligible) FROM stdin;
2	growth	Growth	Dedicated local number, n8n automation — for growing teams replacing Textline.	{"Dedicated local number","n8n automation workflows",Multi-agent,"Priority support"}	7900	5000	14	10	5	f
3	enterprise	Enterprise	Custom domains, RLS isolation, Sovereign Toggle for German residency, HIPAA eligibility.	{"Custom domains","Row-level tenant isolation","Sovereign Toggle (DE residency)","SLA + dedicated CSM","HIPAA-eligible (BAA)"}	19900	0	14	0	0	t
1	starter	Starter	1 Agent, Shared 10DLC pool — for solo operators kicking the tires.	{"1 agent seat","Shared 10DLC pool","Email support"}	2900	1000	14	3	1	f
\.


--
-- Data for Name: usage_records; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.usage_records (id, tenant_id, period_start, period_end, messages_sent, credits_used, credits_included, overage_credits, overage_amount_cents, created_at) FROM stdin;
5	1	2026-05-01 00:00:00+00	2026-05-31 23:59:59.999+00	11	11	1000	0	0	2026-05-04 07:47:04.892802+00
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, email, password_hash, role, created_at) FROM stdin;
1	abc17@gmail.com	d369e592b695e65d99ee9ee8e9a34a6c:d802841b78e37d6c71a5bdcbcbdb6afb99372346a96f0a81396286d4dd02b166ff7c3d6d52e871b71c33e6ff4ecee3d60e4058b51a434dccb997095a6cdadceb	superuser	2026-05-04 04:37:40.810284+00
\.


--
-- Data for Name: webhook_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.webhook_events (id, source, payload, created_at) FROM stdin;
1	twilio	{"To": "+15558675309", "Body": "inbound from carrier", "From": "+4915110001234"}	2026-05-03 05:36:42.838414+00
2	twilio	{"Body": "auth-bypass-check", "From": "+1"}	2026-05-03 09:31:33.030618+00
3	twilio	{"To": "+19094904265", "Body": "hi from a real handset", "From": "+15558675309", "_sama": {"routed": true, "chatwoot": {"detail": "Stubbed: CHATWOOT_BASE_URL / CHATWOOT_API_ACCESS_TOKEN not set", "status": "stubbed", "messageId": null, "conversationId": null}, "tenantId": 1, "tenantSlug": "acme"}}	2026-05-03 09:39:33.086619+00
4	twilio	{"To": "+19999999999", "Body": "who am I supposed to reach", "From": "+15551112222", "_sama": {"reason": "No tenant matches To=+19999999999", "routed": false, "unassignedLead": true}}	2026-05-03 09:39:33.129538+00
5	twilio	{"To": "+19094904265", "Body": "Hi do you offer refunds?", "From": "+15558675309", "_sama": {"routed": true, "chatwoot": {"detail": "Stubbed: CHATWOOT_BASE_URL / CHATWOOT_API_ACCESS_TOKEN not set", "status": "stubbed", "messageId": null, "conversationId": null}, "tenantId": 1, "tenantSlug": "acme"}}	2026-05-03 17:23:28.598313+00
6	twilio	{"To": "+19094904265", "Body": "Hi do you offer refunds and what are your hours?", "From": "+15558675309", "_sama": {"routed": true, "chatwoot": {"detail": "Chatwoot exception: Failed to parse URL from https://textitie.com /api/v1/accounts/1/contacts/search?q=%2B15558675309&include=contact_inboxes", "status": "failed", "messageId": null, "conversationId": null}, "tenantId": 1, "tenantSlug": "acme"}}	2026-05-03 19:35:20.299023+00
7	twilio	{"To": "+19094904265", "Body": "Hi do you offer refunds and what are your hours?", "From": "+15558675309", "_sama": {"routed": true, "chatwoot": {"detail": "Chatwoot exception: Unexpected token '<', \\"<!DOCTYPE \\"... is not valid JSON", "status": "failed", "messageId": null, "conversationId": null}, "tenantId": 1, "tenantSlug": "acme"}}	2026-05-03 19:36:10.692478+00
8	twilio	{"To": "+19094904265", "Body": "Hi do you offer refunds and what are your hours?", "From": "+15558675309", "_sama": {"routed": true, "chatwoot": {"detail": "Chatwoot conv=1 msg=1", "status": "sent", "messageId": 1, "conversationId": 1}, "tenantId": 1, "tenantSlug": "acme"}}	2026-05-04 02:09:01.437727+00
9	twilio	{"To": "+19094904265", "Body": "Sounds great, tell me more!", "From": "+14155553456", "_sama": {"routed": true, "chatwoot": {"detail": "Chatwoot contact create failed: 401", "status": "failed", "messageId": null, "conversationId": null}, "tenantId": 1, "tenantSlug": "acme"}}	2026-05-04 20:41:36.314938+00
10	twilio	{"To": "+19094904265", "Body": "STOP", "From": "+14155551234", "_sama": {"routed": true, "chatwoot": {"detail": "Chatwoot contact create failed: 401", "status": "failed", "messageId": null, "conversationId": null}, "tenantId": 1, "tenantSlug": "acme"}}	2026-05-04 20:41:36.584983+00
\.


--
-- Name: audit_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.audit_logs_id_seq', 14, true);


--
-- Name: automation_rules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.automation_rules_id_seq', 6, true);


--
-- Name: billing_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.billing_events_id_seq', 16, true);


--
-- Name: campaign_messages_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.campaign_messages_id_seq', 4, true);


--
-- Name: campaigns_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.campaigns_id_seq', 6, true);


--
-- Name: contacts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.contacts_id_seq', 7, true);


--
-- Name: conversation_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.conversation_events_id_seq', 7, true);


--
-- Name: conversations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.conversations_id_seq', 7, true);


--
-- Name: crm_sync_queue_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.crm_sync_queue_id_seq', 7, true);


--
-- Name: department_members_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.department_members_id_seq', 1, true);


--
-- Name: departments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.departments_id_seq', 3, true);


--
-- Name: dispositions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.dispositions_id_seq', 1, true);


--
-- Name: email_verifications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.email_verifications_id_seq', 4, true);


--
-- Name: injections_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.injections_id_seq', 5, true);


--
-- Name: integrations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.integrations_id_seq', 1, true);


--
-- Name: message_templates_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.message_templates_id_seq', 7, true);


--
-- Name: messages_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.messages_id_seq', 27, true);


--
-- Name: opt_ins_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.opt_ins_id_seq', 1, true);


--
-- Name: opt_outs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.opt_outs_id_seq', 1, true);


--
-- Name: reminders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.reminders_id_seq', 1, true);


--
-- Name: survey_responses_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.survey_responses_id_seq', 1, true);


--
-- Name: survey_sends_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.survey_sends_id_seq', 1, true);


--
-- Name: surveys_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.surveys_id_seq', 1, true);


--
-- Name: tenant_users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tenant_users_id_seq', 5, true);


--
-- Name: tenants_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tenants_id_seq', 6, true);


--
-- Name: tiers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tiers_id_seq', 3, true);


--
-- Name: usage_records_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.usage_records_id_seq', 5, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_id_seq', 1, true);


--
-- Name: webhook_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.webhook_events_id_seq', 10, true);


--
-- PostgreSQL database dump complete
--

\unrestrict JzAXpdJIt0N6owavOwSMNwjABwISihUdn8uJQ37vkXx88IkE5ANhWcVav6Hp1db

