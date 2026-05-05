--
-- PostgreSQL database dump
--

\restrict hzcviY305aMBb0vwVC8dT4eKLnLjCqz6WjlwjryjpjRXllYMRi4MCC1ZOgLTWjT

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

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    actor_user_id integer,
    actor_email text,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    before_json jsonb,
    after_json jsonb,
    ip text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: automation_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_rules (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    type text NOT NULL,
    name text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    trigger_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    action_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.automation_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: automation_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.automation_rules_id_seq OWNED BY public.automation_rules.id;


--
-- Name: billing_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_events (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    event_type text NOT NULL,
    from_tier text,
    to_tier text,
    amount_cents integer,
    metadata text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: billing_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.billing_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: billing_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.billing_events_id_seq OWNED BY public.billing_events.id;


--
-- Name: campaign_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_messages (
    id integer NOT NULL,
    campaign_id integer NOT NULL,
    conversation_id integer,
    contact_phone text NOT NULL,
    contact_name text,
    rendered_body text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    sent_at timestamp with time zone,
    error_message text,
    external_id text,
    delivered_at timestamp with time zone,
    responded_at timestamp with time zone
);


--
-- Name: campaign_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.campaign_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: campaign_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.campaign_messages_id_seq OWNED BY public.campaign_messages.id;


--
-- Name: campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaigns (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name text NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    segment_filter jsonb,
    total_recipients integer DEFAULT 0 NOT NULL,
    queued_count integer DEFAULT 0 NOT NULL,
    sent_count integer DEFAULT 0 NOT NULL,
    delivered_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    response_count integer DEFAULT 0 NOT NULL,
    opt_out_count integer DEFAULT 0 NOT NULL,
    credits_required integer DEFAULT 0 NOT NULL,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    scheduled_at timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone
);


--
-- Name: campaigns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.campaigns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: campaigns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.campaigns_id_seq OWNED BY public.campaigns.id;


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    phone text NOT NULL,
    name text,
    email text,
    notes text,
    tags text[],
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_interaction_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    location text
);


--
-- Name: contacts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contacts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contacts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contacts_id_seq OWNED BY public.contacts.id;


--
-- Name: conversation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_events (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    event_type text NOT NULL,
    actor_id integer,
    target_id integer,
    note text,
    metadata text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: conversation_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversation_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversation_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversation_events_id_seq OWNED BY public.conversation_events.id;


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    contact_phone text NOT NULL,
    contact_name text,
    status text DEFAULT 'open'::text NOT NULL,
    assigned_user_id integer,
    last_message_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    department_id integer,
    assigned_at timestamp with time zone,
    tags text[],
    contact_id integer,
    disposition_id integer,
    resolution_note text
);


--
-- Name: conversations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversations_id_seq OWNED BY public.conversations.id;


--
-- Name: crm_sync_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_sync_queue (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    provider text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    op text NOT NULL,
    payload_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    external_id text,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crm_sync_queue_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.crm_sync_queue_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_sync_queue_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.crm_sync_queue_id_seq OWNED BY public.crm_sync_queue.id;


--
-- Name: department_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.department_members (
    id integer NOT NULL,
    department_id integer NOT NULL,
    tenant_user_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: department_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.department_members_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: department_members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.department_members_id_seq OWNED BY public.department_members.id;


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name text NOT NULL,
    phone_number text,
    twilio_sid text,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    routing_strategy text DEFAULT 'round_robin'::text NOT NULL
);


--
-- Name: departments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.departments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: departments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.departments_id_seq OWNED BY public.departments.id;


--
-- Name: dispositions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispositions (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    label text NOT NULL,
    color text DEFAULT '#64748b'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    archived boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dispositions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dispositions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dispositions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dispositions_id_seq OWNED BY public.dispositions.id;


--
-- Name: email_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_verifications (
    id integer NOT NULL,
    tenant_user_id integer NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    used boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_verifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_verifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_verifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_verifications_id_seq OWNED BY public.email_verifications.id;


--
-- Name: injections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.injections (
    id integer NOT NULL,
    tenant_id integer,
    to_number text NOT NULL,
    body text NOT NULL,
    status text NOT NULL,
    response_summary text,
    conductor_authorized boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: injections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.injections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: injections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.injections_id_seq OWNED BY public.injections.id;


--
-- Name: integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integrations (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    provider text NOT NULL,
    status text DEFAULT 'disconnected'::text NOT NULL,
    display_name text,
    config_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    settings_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    connected_at timestamp with time zone,
    last_sync_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: integrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.integrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: integrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.integrations_id_seq OWNED BY public.integrations.id;


--
-- Name: message_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_templates (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name text NOT NULL,
    shortcut_key text NOT NULL,
    body text NOT NULL,
    category text,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: message_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.message_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: message_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.message_templates_id_seq OWNED BY public.message_templates.id;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    direction text NOT NULL,
    body text NOT NULL,
    sender_name text,
    read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;


--
-- Name: opt_ins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opt_ins (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    phone text NOT NULL,
    source text NOT NULL,
    consented_at timestamp with time zone DEFAULT now() NOT NULL,
    ip text,
    user_agent text,
    evidence_url text,
    note text,
    revoked_at timestamp with time zone
);


--
-- Name: opt_ins_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.opt_ins_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: opt_ins_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.opt_ins_id_seq OWNED BY public.opt_ins.id;


--
-- Name: opt_outs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opt_outs (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    phone_number text NOT NULL,
    reason text,
    opted_out_at timestamp with time zone DEFAULT now() NOT NULL,
    campaign_id integer
);


--
-- Name: opt_outs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.opt_outs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: opt_outs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.opt_outs_id_seq OWNED BY public.opt_outs.id;


--
-- Name: reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reminders (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    conversation_id integer NOT NULL,
    user_id integer NOT NULL,
    remind_at timestamp with time zone NOT NULL,
    note text,
    fired_at timestamp with time zone,
    dismissed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reminders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reminders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reminders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reminders_id_seq OWNED BY public.reminders.id;


--
-- Name: survey_responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.survey_responses (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    send_id integer NOT NULL,
    score integer NOT NULL,
    comment text,
    responded_at timestamp with time zone DEFAULT now() NOT NULL,
    ip text,
    user_agent text
);


--
-- Name: survey_responses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.survey_responses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: survey_responses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.survey_responses_id_seq OWNED BY public.survey_responses.id;


--
-- Name: survey_sends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.survey_sends (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    survey_id integer NOT NULL,
    conversation_id integer,
    contact_phone text NOT NULL,
    token text NOT NULL,
    sent_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: survey_sends_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.survey_sends_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: survey_sends_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.survey_sends_id_seq OWNED BY public.survey_sends.id;


--
-- Name: surveys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.surveys (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    type text DEFAULT 'csat'::text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    prompt text DEFAULT 'How would you rate your experience? Please tap the link to leave a rating:'::text NOT NULL,
    thank_you text DEFAULT 'Thanks for your feedback!'::text NOT NULL,
    send_after_close boolean DEFAULT true NOT NULL,
    send_delay_minutes integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: surveys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.surveys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: surveys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.surveys_id_seq OWNED BY public.surveys.id;


--
-- Name: tenant_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_users (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    name text NOT NULL,
    role text DEFAULT 'agent'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'offline'::text NOT NULL,
    skills text,
    languages text,
    last_assigned_at timestamp with time zone
);


--
-- Name: tenant_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenant_users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenant_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenant_users_id_seq OWNED BY public.tenant_users.id;


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id integer NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    region text NOT NULL,
    tier_code text NOT NULL,
    sovereign_toggle boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    phone_number text,
    chatwoot_account_id integer,
    chatwoot_inbox_id integer,
    knowledge_base text,
    stripe_customer_id text,
    stripe_subscription_id text,
    subscription_status text DEFAULT 'none'::text NOT NULL,
    plan_tier_code text,
    trial_ends_at timestamp with time zone,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    trial_used boolean DEFAULT false NOT NULL,
    prepaid_credits integer DEFAULT 0 NOT NULL,
    overage_enabled boolean DEFAULT false NOT NULL,
    quiet_hours_start integer,
    quiet_hours_end integer,
    quiet_hours_tz text DEFAULT 'America/New_York'::text NOT NULL,
    frequency_cap_per_day integer DEFAULT 0 NOT NULL,
    require_double_opt_in boolean DEFAULT false NOT NULL,
    hipaa_enabled boolean DEFAULT false NOT NULL,
    baa_acknowledged_at timestamp with time zone,
    baa_acknowledged_by integer
);


--
-- Name: tenants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenants_id_seq OWNED BY public.tenants.id;


--
-- Name: tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tiers (
    id integer NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    features text[] DEFAULT '{}'::text[] NOT NULL,
    monthly_price_cents integer DEFAULT 0 NOT NULL,
    included_credits integer DEFAULT 0 NOT NULL,
    trial_days integer DEFAULT 14 NOT NULL,
    max_agents integer DEFAULT 1 NOT NULL,
    max_phone_numbers integer DEFAULT 1 NOT NULL,
    hipaa_eligible boolean DEFAULT false NOT NULL
);


--
-- Name: tiers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tiers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tiers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tiers_id_seq OWNED BY public.tiers.id;


--
-- Name: usage_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_records (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    messages_sent integer DEFAULT 0 NOT NULL,
    credits_used integer DEFAULT 0 NOT NULL,
    credits_included integer DEFAULT 0 NOT NULL,
    overage_credits integer DEFAULT 0 NOT NULL,
    overage_amount_cents integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: usage_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.usage_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: usage_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.usage_records_id_seq OWNED BY public.usage_records.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role text DEFAULT 'user'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events (
    id integer NOT NULL,
    source text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: webhook_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.webhook_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: webhook_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.webhook_events_id_seq OWNED BY public.webhook_events.id;


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: automation_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_rules ALTER COLUMN id SET DEFAULT nextval('public.automation_rules_id_seq'::regclass);


--
-- Name: billing_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_events ALTER COLUMN id SET DEFAULT nextval('public.billing_events_id_seq'::regclass);


--
-- Name: campaign_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_messages ALTER COLUMN id SET DEFAULT nextval('public.campaign_messages_id_seq'::regclass);


--
-- Name: campaigns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns ALTER COLUMN id SET DEFAULT nextval('public.campaigns_id_seq'::regclass);


--
-- Name: contacts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts ALTER COLUMN id SET DEFAULT nextval('public.contacts_id_seq'::regclass);


--
-- Name: conversation_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_events ALTER COLUMN id SET DEFAULT nextval('public.conversation_events_id_seq'::regclass);


--
-- Name: conversations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations ALTER COLUMN id SET DEFAULT nextval('public.conversations_id_seq'::regclass);


--
-- Name: crm_sync_queue id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sync_queue ALTER COLUMN id SET DEFAULT nextval('public.crm_sync_queue_id_seq'::regclass);


--
-- Name: department_members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_members ALTER COLUMN id SET DEFAULT nextval('public.department_members_id_seq'::regclass);


--
-- Name: departments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments ALTER COLUMN id SET DEFAULT nextval('public.departments_id_seq'::regclass);


--
-- Name: dispositions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispositions ALTER COLUMN id SET DEFAULT nextval('public.dispositions_id_seq'::regclass);


--
-- Name: email_verifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications ALTER COLUMN id SET DEFAULT nextval('public.email_verifications_id_seq'::regclass);


--
-- Name: injections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.injections ALTER COLUMN id SET DEFAULT nextval('public.injections_id_seq'::regclass);


--
-- Name: integrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations ALTER COLUMN id SET DEFAULT nextval('public.integrations_id_seq'::regclass);


--
-- Name: message_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates ALTER COLUMN id SET DEFAULT nextval('public.message_templates_id_seq'::regclass);


--
-- Name: messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);


--
-- Name: opt_ins id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_ins ALTER COLUMN id SET DEFAULT nextval('public.opt_ins_id_seq'::regclass);


--
-- Name: opt_outs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_outs ALTER COLUMN id SET DEFAULT nextval('public.opt_outs_id_seq'::regclass);


--
-- Name: reminders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders ALTER COLUMN id SET DEFAULT nextval('public.reminders_id_seq'::regclass);


--
-- Name: survey_responses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_responses ALTER COLUMN id SET DEFAULT nextval('public.survey_responses_id_seq'::regclass);


--
-- Name: survey_sends id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_sends ALTER COLUMN id SET DEFAULT nextval('public.survey_sends_id_seq'::regclass);


--
-- Name: surveys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.surveys ALTER COLUMN id SET DEFAULT nextval('public.surveys_id_seq'::regclass);


--
-- Name: tenant_users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_users ALTER COLUMN id SET DEFAULT nextval('public.tenant_users_id_seq'::regclass);


--
-- Name: tenants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants ALTER COLUMN id SET DEFAULT nextval('public.tenants_id_seq'::regclass);


--
-- Name: tiers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tiers ALTER COLUMN id SET DEFAULT nextval('public.tiers_id_seq'::regclass);


--
-- Name: usage_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_records ALTER COLUMN id SET DEFAULT nextval('public.usage_records_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: webhook_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events ALTER COLUMN id SET DEFAULT nextval('public.webhook_events_id_seq'::regclass);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: automation_rules automation_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_rules
    ADD CONSTRAINT automation_rules_pkey PRIMARY KEY (id);


--
-- Name: billing_events billing_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_events
    ADD CONSTRAINT billing_events_pkey PRIMARY KEY (id);


--
-- Name: campaign_messages campaign_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_messages
    ADD CONSTRAINT campaign_messages_pkey PRIMARY KEY (id);


--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: conversation_events conversation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_events
    ADD CONSTRAINT conversation_events_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: crm_sync_queue crm_sync_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sync_queue
    ADD CONSTRAINT crm_sync_queue_pkey PRIMARY KEY (id);


--
-- Name: department_members department_members_department_id_tenant_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_members
    ADD CONSTRAINT department_members_department_id_tenant_user_id_unique UNIQUE (department_id, tenant_user_id);


--
-- Name: department_members department_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_members
    ADD CONSTRAINT department_members_pkey PRIMARY KEY (id);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: dispositions dispositions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispositions
    ADD CONSTRAINT dispositions_pkey PRIMARY KEY (id);


--
-- Name: email_verifications email_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_pkey PRIMARY KEY (id);


--
-- Name: injections injections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.injections
    ADD CONSTRAINT injections_pkey PRIMARY KEY (id);


--
-- Name: integrations integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_pkey PRIMARY KEY (id);


--
-- Name: message_templates message_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: opt_ins opt_ins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_ins
    ADD CONSTRAINT opt_ins_pkey PRIMARY KEY (id);


--
-- Name: opt_outs opt_outs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_outs
    ADD CONSTRAINT opt_outs_pkey PRIMARY KEY (id);


--
-- Name: reminders reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_pkey PRIMARY KEY (id);


--
-- Name: survey_responses survey_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_responses
    ADD CONSTRAINT survey_responses_pkey PRIMARY KEY (id);


--
-- Name: survey_sends survey_sends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_sends
    ADD CONSTRAINT survey_sends_pkey PRIMARY KEY (id);


--
-- Name: surveys surveys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.surveys
    ADD CONSTRAINT surveys_pkey PRIMARY KEY (id);


--
-- Name: tenant_users tenant_users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_users
    ADD CONSTRAINT tenant_users_email_unique UNIQUE (email);


--
-- Name: tenant_users tenant_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_users
    ADD CONSTRAINT tenant_users_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_unique UNIQUE (slug);


--
-- Name: tiers tiers_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tiers
    ADD CONSTRAINT tiers_code_unique UNIQUE (code);


--
-- Name: tiers tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tiers
    ADD CONSTRAINT tiers_pkey PRIMARY KEY (id);


--
-- Name: usage_records usage_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_records
    ADD CONSTRAINT usage_records_pkey PRIMARY KEY (id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- Name: audit_logs_tenant_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_tenant_created_idx ON public.audit_logs USING btree (tenant_id, created_at);


--
-- Name: audit_logs_tenant_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_tenant_entity_idx ON public.audit_logs USING btree (tenant_id, entity_type, entity_id);


--
-- Name: campaign_messages_external_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_messages_external_id_idx ON public.campaign_messages USING btree (external_id);


--
-- Name: campaign_messages_phone_sent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_messages_phone_sent_idx ON public.campaign_messages USING btree (contact_phone, sent_at);


--
-- Name: campaigns_status_scheduled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaigns_status_scheduled_idx ON public.campaigns USING btree (status, scheduled_at);


--
-- Name: contacts_tenant_last_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_tenant_last_idx ON public.contacts USING btree (tenant_id, last_interaction_at);


--
-- Name: contacts_tenant_phone_unq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX contacts_tenant_phone_unq ON public.contacts USING btree (tenant_id, phone);


--
-- Name: conversations_tenant_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversations_tenant_created_idx ON public.conversations USING btree (tenant_id, created_at);


--
-- Name: crm_sync_queue_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_sync_queue_pending_idx ON public.crm_sync_queue USING btree (status, next_attempt_at);


--
-- Name: crm_sync_queue_tenant_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_sync_queue_tenant_status_idx ON public.crm_sync_queue USING btree (tenant_id, status, next_attempt_at);


--
-- Name: dispositions_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dispositions_tenant_idx ON public.dispositions USING btree (tenant_id, archived, sort_order);


--
-- Name: dispositions_tenant_label_unq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX dispositions_tenant_label_unq ON public.dispositions USING btree (tenant_id, label);


--
-- Name: integrations_tenant_provider_unq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX integrations_tenant_provider_unq ON public.integrations USING btree (tenant_id, provider);


--
-- Name: messages_conv_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_conv_created_idx ON public.messages USING btree (conversation_id, created_at);


--
-- Name: messages_conv_dir_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_conv_dir_created_idx ON public.messages USING btree (conversation_id, direction, created_at);


--
-- Name: opt_ins_tenant_consented_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opt_ins_tenant_consented_idx ON public.opt_ins USING btree (tenant_id, consented_at);


--
-- Name: opt_ins_tenant_phone_unq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX opt_ins_tenant_phone_unq ON public.opt_ins USING btree (tenant_id, phone);


--
-- Name: opt_outs_tenant_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX opt_outs_tenant_phone_idx ON public.opt_outs USING btree (tenant_id, phone_number);


--
-- Name: reminders_conv_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminders_conv_idx ON public.reminders USING btree (conversation_id);


--
-- Name: reminders_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminders_pending_idx ON public.reminders USING btree (fired_at, remind_at);


--
-- Name: reminders_tenant_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminders_tenant_user_idx ON public.reminders USING btree (tenant_id, user_id, dismissed_at);


--
-- Name: survey_responses_send_unq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX survey_responses_send_unq ON public.survey_responses USING btree (send_id);


--
-- Name: survey_responses_tenant_responded_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX survey_responses_tenant_responded_idx ON public.survey_responses USING btree (tenant_id, responded_at);


--
-- Name: survey_sends_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX survey_sends_status_idx ON public.survey_sends USING btree (status, sent_at);


--
-- Name: survey_sends_tenant_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX survey_sends_tenant_created_idx ON public.survey_sends USING btree (tenant_id, created_at);


--
-- Name: survey_sends_token_unq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX survey_sends_token_unq ON public.survey_sends USING btree (token);


--
-- Name: surveys_tenant_type_unq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX surveys_tenant_type_unq ON public.surveys USING btree (tenant_id, type);


--
-- Name: uq_message_templates_tenant_shortcut; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_message_templates_tenant_shortcut ON public.message_templates USING btree (tenant_id, shortcut_key);


--
-- Name: uq_usage_tenant_period; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_usage_tenant_period ON public.usage_records USING btree (tenant_id, period_start);


--
-- Name: audit_logs audit_logs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: automation_rules automation_rules_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_rules
    ADD CONSTRAINT automation_rules_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: billing_events billing_events_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_events
    ADD CONSTRAINT billing_events_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: campaign_messages campaign_messages_campaign_id_campaigns_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_messages
    ADD CONSTRAINT campaign_messages_campaign_id_campaigns_id_fk FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: campaign_messages campaign_messages_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_messages
    ADD CONSTRAINT campaign_messages_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;


--
-- Name: campaigns campaigns_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: conversation_events conversation_events_actor_id_tenant_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_events
    ADD CONSTRAINT conversation_events_actor_id_tenant_users_id_fk FOREIGN KEY (actor_id) REFERENCES public.tenant_users(id) ON DELETE SET NULL;


--
-- Name: conversation_events conversation_events_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_events
    ADD CONSTRAINT conversation_events_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_events conversation_events_target_id_tenant_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_events
    ADD CONSTRAINT conversation_events_target_id_tenant_users_id_fk FOREIGN KEY (target_id) REFERENCES public.tenant_users(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_assigned_user_id_tenant_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_assigned_user_id_tenant_users_id_fk FOREIGN KEY (assigned_user_id) REFERENCES public.tenant_users(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_department_id_departments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_department_id_departments_id_fk FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: crm_sync_queue crm_sync_queue_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sync_queue
    ADD CONSTRAINT crm_sync_queue_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: department_members department_members_department_id_departments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_members
    ADD CONSTRAINT department_members_department_id_departments_id_fk FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE;


--
-- Name: department_members department_members_tenant_user_id_tenant_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_members
    ADD CONSTRAINT department_members_tenant_user_id_tenant_users_id_fk FOREIGN KEY (tenant_user_id) REFERENCES public.tenant_users(id) ON DELETE CASCADE;


--
-- Name: departments departments_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: dispositions dispositions_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispositions
    ADD CONSTRAINT dispositions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: email_verifications email_verifications_tenant_user_id_tenant_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_tenant_user_id_tenant_users_id_fk FOREIGN KEY (tenant_user_id) REFERENCES public.tenant_users(id) ON DELETE CASCADE;


--
-- Name: integrations integrations_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: message_templates message_templates_created_by_tenant_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_created_by_tenant_users_id_fk FOREIGN KEY (created_by) REFERENCES public.tenant_users(id) ON DELETE SET NULL;


--
-- Name: message_templates message_templates_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: messages messages_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);


--
-- Name: opt_ins opt_ins_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_ins
    ADD CONSTRAINT opt_ins_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: opt_outs opt_outs_campaign_id_campaigns_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_outs
    ADD CONSTRAINT opt_outs_campaign_id_campaigns_id_fk FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;


--
-- Name: opt_outs opt_outs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_outs
    ADD CONSTRAINT opt_outs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: reminders reminders_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: reminders reminders_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: reminders reminders_user_id_tenant_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_user_id_tenant_users_id_fk FOREIGN KEY (user_id) REFERENCES public.tenant_users(id) ON DELETE CASCADE;


--
-- Name: survey_responses survey_responses_send_id_survey_sends_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_responses
    ADD CONSTRAINT survey_responses_send_id_survey_sends_id_fk FOREIGN KEY (send_id) REFERENCES public.survey_sends(id) ON DELETE CASCADE;


--
-- Name: survey_responses survey_responses_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_responses
    ADD CONSTRAINT survey_responses_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: survey_sends survey_sends_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_sends
    ADD CONSTRAINT survey_sends_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;


--
-- Name: survey_sends survey_sends_survey_id_surveys_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_sends
    ADD CONSTRAINT survey_sends_survey_id_surveys_id_fk FOREIGN KEY (survey_id) REFERENCES public.surveys(id) ON DELETE CASCADE;


--
-- Name: survey_sends survey_sends_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_sends
    ADD CONSTRAINT survey_sends_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: surveys surveys_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.surveys
    ADD CONSTRAINT surveys_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_users tenant_users_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_users
    ADD CONSTRAINT tenant_users_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: usage_records usage_records_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_records
    ADD CONSTRAINT usage_records_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict hzcviY305aMBb0vwVC8dT4eKLnLjCqz6WjlwjryjpjRXllYMRi4MCC1ZOgLTWjT

