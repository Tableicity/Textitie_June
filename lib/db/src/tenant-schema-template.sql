--
--






--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.audit_logs (
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

CREATE SEQUENCE __SCHEMA__.audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.audit_logs_id_seq OWNED BY __SCHEMA__.audit_logs.id;


--
-- Name: automation_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.automation_rules (
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

CREATE SEQUENCE __SCHEMA__.automation_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: automation_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.automation_rules_id_seq OWNED BY __SCHEMA__.automation_rules.id;


--
-- Name: billing_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.billing_events (
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

CREATE SEQUENCE __SCHEMA__.billing_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: billing_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.billing_events_id_seq OWNED BY __SCHEMA__.billing_events.id;


--
-- Name: campaign_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.campaign_messages (
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

CREATE SEQUENCE __SCHEMA__.campaign_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: campaign_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.campaign_messages_id_seq OWNED BY __SCHEMA__.campaign_messages.id;


--
-- Name: campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.campaigns (
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

CREATE SEQUENCE __SCHEMA__.campaigns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: campaigns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.campaigns_id_seq OWNED BY __SCHEMA__.campaigns.id;


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.contacts (
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

CREATE SEQUENCE __SCHEMA__.contacts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contacts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.contacts_id_seq OWNED BY __SCHEMA__.contacts.id;


--
-- Name: conversation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.conversation_events (
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

CREATE SEQUENCE __SCHEMA__.conversation_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversation_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.conversation_events_id_seq OWNED BY __SCHEMA__.conversation_events.id;


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.conversations (
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

CREATE SEQUENCE __SCHEMA__.conversations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.conversations_id_seq OWNED BY __SCHEMA__.conversations.id;


--
-- Name: crm_sync_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.crm_sync_queue (
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

CREATE SEQUENCE __SCHEMA__.crm_sync_queue_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crm_sync_queue_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.crm_sync_queue_id_seq OWNED BY __SCHEMA__.crm_sync_queue.id;


--
-- Name: department_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.department_members (
    id integer NOT NULL,
    department_id integer NOT NULL,
    tenant_user_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: department_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE __SCHEMA__.department_members_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: department_members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.department_members_id_seq OWNED BY __SCHEMA__.department_members.id;


--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.departments (
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

CREATE SEQUENCE __SCHEMA__.departments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: departments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.departments_id_seq OWNED BY __SCHEMA__.departments.id;


--
-- Name: dispositions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.dispositions (
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

CREATE SEQUENCE __SCHEMA__.dispositions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dispositions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.dispositions_id_seq OWNED BY __SCHEMA__.dispositions.id;


--
-- Name: integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.integrations (
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

CREATE SEQUENCE __SCHEMA__.integrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: integrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.integrations_id_seq OWNED BY __SCHEMA__.integrations.id;


--
-- Name: message_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.message_templates (
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

CREATE SEQUENCE __SCHEMA__.message_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: message_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.message_templates_id_seq OWNED BY __SCHEMA__.message_templates.id;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.messages (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    direction text NOT NULL,
    body text NOT NULL,
    sender_name text,
    read boolean DEFAULT false NOT NULL,
    external_id text,
    status text DEFAULT 'sent' NOT NULL,
    error_code text,
    error_message text,
    delivered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE __SCHEMA__.messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.messages_id_seq OWNED BY __SCHEMA__.messages.id;


--
-- Name: opt_ins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.opt_ins (
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

CREATE SEQUENCE __SCHEMA__.opt_ins_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: opt_ins_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.opt_ins_id_seq OWNED BY __SCHEMA__.opt_ins.id;


--
-- Name: opt_outs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.opt_outs (
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

CREATE SEQUENCE __SCHEMA__.opt_outs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: opt_outs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.opt_outs_id_seq OWNED BY __SCHEMA__.opt_outs.id;


--
-- Name: reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.reminders (
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

CREATE SEQUENCE __SCHEMA__.reminders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reminders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.reminders_id_seq OWNED BY __SCHEMA__.reminders.id;


--
-- Name: survey_responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.survey_responses (
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

CREATE SEQUENCE __SCHEMA__.survey_responses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: survey_responses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.survey_responses_id_seq OWNED BY __SCHEMA__.survey_responses.id;


--
-- Name: survey_sends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.survey_sends (
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

CREATE SEQUENCE __SCHEMA__.survey_sends_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: survey_sends_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.survey_sends_id_seq OWNED BY __SCHEMA__.survey_sends.id;


--
-- Name: surveys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.surveys (
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

CREATE SEQUENCE __SCHEMA__.surveys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: surveys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.surveys_id_seq OWNED BY __SCHEMA__.surveys.id;


--
-- Name: usage_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE __SCHEMA__.usage_records (
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

CREATE SEQUENCE __SCHEMA__.usage_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: usage_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE __SCHEMA__.usage_records_id_seq OWNED BY __SCHEMA__.usage_records.id;


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.audit_logs ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.audit_logs_id_seq'::regclass);


--
-- Name: automation_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.automation_rules ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.automation_rules_id_seq'::regclass);


--
-- Name: billing_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.billing_events ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.billing_events_id_seq'::regclass);


--
-- Name: campaign_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.campaign_messages ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.campaign_messages_id_seq'::regclass);


--
-- Name: campaigns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.campaigns ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.campaigns_id_seq'::regclass);


--
-- Name: contacts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.contacts ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.contacts_id_seq'::regclass);


--
-- Name: conversation_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.conversation_events ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.conversation_events_id_seq'::regclass);


--
-- Name: conversations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.conversations ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.conversations_id_seq'::regclass);


--
-- Name: crm_sync_queue id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.crm_sync_queue ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.crm_sync_queue_id_seq'::regclass);


--
-- Name: department_members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.department_members ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.department_members_id_seq'::regclass);


--
-- Name: departments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.departments ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.departments_id_seq'::regclass);


--
-- Name: dispositions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.dispositions ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.dispositions_id_seq'::regclass);


--
-- Name: integrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.integrations ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.integrations_id_seq'::regclass);


--
-- Name: message_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.message_templates ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.message_templates_id_seq'::regclass);


--
-- Name: messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.messages ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.messages_id_seq'::regclass);


--
-- Name: opt_ins id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.opt_ins ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.opt_ins_id_seq'::regclass);


--
-- Name: opt_outs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.opt_outs ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.opt_outs_id_seq'::regclass);


--
-- Name: reminders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.reminders ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.reminders_id_seq'::regclass);


--
-- Name: survey_responses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.survey_responses ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.survey_responses_id_seq'::regclass);


--
-- Name: survey_sends id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.survey_sends ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.survey_sends_id_seq'::regclass);


--
-- Name: surveys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.surveys ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.surveys_id_seq'::regclass);


--
-- Name: usage_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.usage_records ALTER COLUMN id SET DEFAULT nextval('__SCHEMA__.usage_records_id_seq'::regclass);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: automation_rules automation_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.automation_rules
    ADD CONSTRAINT automation_rules_pkey PRIMARY KEY (id);


--
-- Name: billing_events billing_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.billing_events
    ADD CONSTRAINT billing_events_pkey PRIMARY KEY (id);


--
-- Name: campaign_messages campaign_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.campaign_messages
    ADD CONSTRAINT campaign_messages_pkey PRIMARY KEY (id);


--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: conversation_events conversation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.conversation_events
    ADD CONSTRAINT conversation_events_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: crm_sync_queue crm_sync_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.crm_sync_queue
    ADD CONSTRAINT crm_sync_queue_pkey PRIMARY KEY (id);


--
-- Name: department_members department_members_department_id_tenant_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.department_members
    ADD CONSTRAINT department_members_department_id_tenant_user_id_unique UNIQUE (department_id, tenant_user_id);


--
-- Name: department_members department_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.department_members
    ADD CONSTRAINT department_members_pkey PRIMARY KEY (id);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: dispositions dispositions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.dispositions
    ADD CONSTRAINT dispositions_pkey PRIMARY KEY (id);


--
-- Name: integrations integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.integrations
    ADD CONSTRAINT integrations_pkey PRIMARY KEY (id);


--
-- Name: message_templates message_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.message_templates
    ADD CONSTRAINT message_templates_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: opt_ins opt_ins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.opt_ins
    ADD CONSTRAINT opt_ins_pkey PRIMARY KEY (id);


--
-- Name: opt_outs opt_outs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.opt_outs
    ADD CONSTRAINT opt_outs_pkey PRIMARY KEY (id);


--
-- Name: reminders reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.reminders
    ADD CONSTRAINT reminders_pkey PRIMARY KEY (id);


--
-- Name: survey_responses survey_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.survey_responses
    ADD CONSTRAINT survey_responses_pkey PRIMARY KEY (id);


--
-- Name: survey_sends survey_sends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.survey_sends
    ADD CONSTRAINT survey_sends_pkey PRIMARY KEY (id);


--
-- Name: surveys surveys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.surveys
    ADD CONSTRAINT surveys_pkey PRIMARY KEY (id);


--
-- Name: usage_records usage_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.usage_records
    ADD CONSTRAINT usage_records_pkey PRIMARY KEY (id);


--
-- Name: audit_logs_tenant_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_tenant_created_idx ON __SCHEMA__.audit_logs USING btree (tenant_id, created_at);


--
-- Name: audit_logs_tenant_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_tenant_entity_idx ON __SCHEMA__.audit_logs USING btree (tenant_id, entity_type, entity_id);


--
-- Name: campaign_messages_external_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_messages_external_id_idx ON __SCHEMA__.campaign_messages USING btree (external_id);


--
-- Name: campaign_messages_phone_sent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_messages_phone_sent_idx ON __SCHEMA__.campaign_messages USING btree (contact_phone, sent_at);


--
-- Name: campaigns_status_scheduled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaigns_status_scheduled_idx ON __SCHEMA__.campaigns USING btree (status, scheduled_at);


--
-- Name: contacts_tenant_last_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_tenant_last_idx ON __SCHEMA__.contacts USING btree (tenant_id, last_interaction_at);


--
-- Name: contacts_tenant_phone_unq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX contacts_tenant_phone_unq ON __SCHEMA__.contacts USING btree (tenant_id, phone);


--
-- Name: conversations_tenant_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversations_tenant_created_idx ON __SCHEMA__.conversations USING btree (tenant_id, created_at);


--
-- Name: crm_sync_queue_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_sync_queue_pending_idx ON __SCHEMA__.crm_sync_queue USING btree (status, next_attempt_at);


--
-- Name: crm_sync_queue_tenant_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_sync_queue_tenant_status_idx ON __SCHEMA__.crm_sync_queue USING btree (tenant_id, status, next_attempt_at);


--
-- Name: dispositions_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dispositions_tenant_idx ON __SCHEMA__.dispositions USING btree (tenant_id, archived, sort_order);


--
-- Name: dispositions_tenant_label_unq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX dispositions_tenant_label_unq ON __SCHEMA__.dispositions USING btree (tenant_id, label);


--
-- Name: integrations_tenant_provider_unq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX integrations_tenant_provider_unq ON __SCHEMA__.integrations USING btree (tenant_id, provider);


--
-- Name: messages_conv_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_conv_created_idx ON __SCHEMA__.messages USING btree (conversation_id, created_at);


--
-- Name: messages_conv_dir_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_conv_dir_created_idx ON __SCHEMA__.messages USING btree (conversation_id, direction, created_at);


--
-- Name: opt_ins_tenant_consented_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opt_ins_tenant_consented_idx ON __SCHEMA__.opt_ins USING btree (tenant_id, consented_at);


--
-- Name: opt_ins_tenant_phone_unq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX opt_ins_tenant_phone_unq ON __SCHEMA__.opt_ins USING btree (tenant_id, phone);


--
-- Name: opt_outs_tenant_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX opt_outs_tenant_phone_idx ON __SCHEMA__.opt_outs USING btree (tenant_id, phone_number);


--
-- Name: reminders_conv_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminders_conv_idx ON __SCHEMA__.reminders USING btree (conversation_id);


--
-- Name: reminders_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminders_pending_idx ON __SCHEMA__.reminders USING btree (fired_at, remind_at);


--
-- Name: reminders_tenant_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reminders_tenant_user_idx ON __SCHEMA__.reminders USING btree (tenant_id, user_id, dismissed_at);


--
-- Name: survey_responses_send_unq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX survey_responses_send_unq ON __SCHEMA__.survey_responses USING btree (send_id);


--
-- Name: survey_responses_tenant_responded_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX survey_responses_tenant_responded_idx ON __SCHEMA__.survey_responses USING btree (tenant_id, responded_at);


--
-- Name: survey_sends_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX survey_sends_status_idx ON __SCHEMA__.survey_sends USING btree (status, sent_at);


--
-- Name: survey_sends_tenant_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX survey_sends_tenant_created_idx ON __SCHEMA__.survey_sends USING btree (tenant_id, created_at);


--
-- Name: survey_sends_token_unq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX survey_sends_token_unq ON __SCHEMA__.survey_sends USING btree (token);


--
-- Name: surveys_tenant_type_unq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX surveys_tenant_type_unq ON __SCHEMA__.surveys USING btree (tenant_id, type);


--
-- Name: uq_message_templates_tenant_shortcut; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_message_templates_tenant_shortcut ON __SCHEMA__.message_templates USING btree (tenant_id, shortcut_key);


--
-- Name: uq_usage_tenant_period; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_usage_tenant_period ON __SCHEMA__.usage_records USING btree (tenant_id, period_start);


--
-- Name: audit_logs audit_logs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.audit_logs
    ADD CONSTRAINT audit_logs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: automation_rules automation_rules_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.automation_rules
    ADD CONSTRAINT automation_rules_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: billing_events billing_events_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.billing_events
    ADD CONSTRAINT billing_events_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: campaign_messages campaign_messages_campaign_id_campaigns_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.campaign_messages
    ADD CONSTRAINT campaign_messages_campaign_id_campaigns_id_fk FOREIGN KEY (campaign_id) REFERENCES __SCHEMA__.campaigns(id) ON DELETE CASCADE;


--
-- Name: campaign_messages campaign_messages_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.campaign_messages
    ADD CONSTRAINT campaign_messages_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES __SCHEMA__.conversations(id) ON DELETE SET NULL;


--
-- Name: campaigns campaigns_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.campaigns
    ADD CONSTRAINT campaigns_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.contacts
    ADD CONSTRAINT contacts_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: conversation_events conversation_events_actor_id_tenant_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.conversation_events
    ADD CONSTRAINT conversation_events_actor_id_tenant_users_id_fk FOREIGN KEY (actor_id) REFERENCES public.tenant_users(id) ON DELETE SET NULL;


--
-- Name: conversation_events conversation_events_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.conversation_events
    ADD CONSTRAINT conversation_events_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES __SCHEMA__.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_events conversation_events_target_id_tenant_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.conversation_events
    ADD CONSTRAINT conversation_events_target_id_tenant_users_id_fk FOREIGN KEY (target_id) REFERENCES public.tenant_users(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_assigned_user_id_tenant_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.conversations
    ADD CONSTRAINT conversations_assigned_user_id_tenant_users_id_fk FOREIGN KEY (assigned_user_id) REFERENCES public.tenant_users(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_department_id_departments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.conversations
    ADD CONSTRAINT conversations_department_id_departments_id_fk FOREIGN KEY (department_id) REFERENCES __SCHEMA__.departments(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.conversations
    ADD CONSTRAINT conversations_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: crm_sync_queue crm_sync_queue_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.crm_sync_queue
    ADD CONSTRAINT crm_sync_queue_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: department_members department_members_department_id_departments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.department_members
    ADD CONSTRAINT department_members_department_id_departments_id_fk FOREIGN KEY (department_id) REFERENCES __SCHEMA__.departments(id) ON DELETE CASCADE;


--
-- Name: department_members department_members_tenant_user_id_tenant_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.department_members
    ADD CONSTRAINT department_members_tenant_user_id_tenant_users_id_fk FOREIGN KEY (tenant_user_id) REFERENCES public.tenant_users(id) ON DELETE CASCADE;


--
-- Name: departments departments_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.departments
    ADD CONSTRAINT departments_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: dispositions dispositions_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.dispositions
    ADD CONSTRAINT dispositions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: integrations integrations_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.integrations
    ADD CONSTRAINT integrations_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: message_templates message_templates_created_by_tenant_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.message_templates
    ADD CONSTRAINT message_templates_created_by_tenant_users_id_fk FOREIGN KEY (created_by) REFERENCES public.tenant_users(id) ON DELETE SET NULL;


--
-- Name: message_templates message_templates_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.message_templates
    ADD CONSTRAINT message_templates_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: messages messages_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.messages
    ADD CONSTRAINT messages_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES __SCHEMA__.conversations(id);


--
-- Name: opt_ins opt_ins_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.opt_ins
    ADD CONSTRAINT opt_ins_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: opt_outs opt_outs_campaign_id_campaigns_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.opt_outs
    ADD CONSTRAINT opt_outs_campaign_id_campaigns_id_fk FOREIGN KEY (campaign_id) REFERENCES __SCHEMA__.campaigns(id) ON DELETE SET NULL;


--
-- Name: opt_outs opt_outs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.opt_outs
    ADD CONSTRAINT opt_outs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: reminders reminders_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.reminders
    ADD CONSTRAINT reminders_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES __SCHEMA__.conversations(id) ON DELETE CASCADE;


--
-- Name: reminders reminders_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.reminders
    ADD CONSTRAINT reminders_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: reminders reminders_user_id_tenant_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.reminders
    ADD CONSTRAINT reminders_user_id_tenant_users_id_fk FOREIGN KEY (user_id) REFERENCES public.tenant_users(id) ON DELETE CASCADE;


--
-- Name: survey_responses survey_responses_send_id_survey_sends_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.survey_responses
    ADD CONSTRAINT survey_responses_send_id_survey_sends_id_fk FOREIGN KEY (send_id) REFERENCES __SCHEMA__.survey_sends(id) ON DELETE CASCADE;


--
-- Name: survey_responses survey_responses_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.survey_responses
    ADD CONSTRAINT survey_responses_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: survey_sends survey_sends_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.survey_sends
    ADD CONSTRAINT survey_sends_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES __SCHEMA__.conversations(id) ON DELETE SET NULL;


--
-- Name: survey_sends survey_sends_survey_id_surveys_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.survey_sends
    ADD CONSTRAINT survey_sends_survey_id_surveys_id_fk FOREIGN KEY (survey_id) REFERENCES __SCHEMA__.surveys(id) ON DELETE CASCADE;


--
-- Name: survey_sends survey_sends_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.survey_sends
    ADD CONSTRAINT survey_sends_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: surveys surveys_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.surveys
    ADD CONSTRAINT surveys_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: usage_records usage_records_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY __SCHEMA__.usage_records
    ADD CONSTRAINT usage_records_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
--


