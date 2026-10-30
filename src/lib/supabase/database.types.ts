export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      ai_batches: {
        Row: {
          capability: string;
          created_at: string;
          ended_at: string | null;
          id: string;
          org_id: string;
          provider_batch_id: string;
          request_count: number;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          capability: string;
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          org_id: string;
          provider_batch_id: string;
          request_count?: number;
          status?: string;
        };
        Update: {
          capability?: string;
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          org_id?: string;
          provider_batch_id?: string;
          request_count?: number;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_batches_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_budgets: {
        Row: {
          action: string;
          alerted_on: string | null;
          capability: string | null;
          created_at: string;
          daily_usd: number | null;
          id: string;
          monthly_usd: number | null;
          org_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          action?: string;
          alerted_on?: string | null;
          capability?: string | null;
          created_at?: string;
          daily_usd?: number | null;
          id?: string;
          monthly_usd?: number | null;
          org_id: string;
          updated_at?: string;
        };
        Update: {
          action?: string;
          alerted_on?: string | null;
          capability?: string | null;
          created_at?: string;
          daily_usd?: number | null;
          id?: string;
          monthly_usd?: number | null;
          org_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_budgets_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_capabilities: {
        Row: {
          description: string;
          effort: string;
          enabled: boolean;
          key: string;
          label: string;
          max_tokens: number;
          model: string;
          sort: number;
        };
        ComputedFields: never;
        Insert: {
          description?: string;
          effort?: string;
          enabled?: boolean;
          key: string;
          label: string;
          max_tokens?: number;
          model: string;
          sort?: number;
        };
        Update: {
          description?: string;
          effort?: string;
          enabled?: boolean;
          key?: string;
          label?: string;
          max_tokens?: number;
          model?: string;
          sort?: number;
        };
        Relationships: [];
      };
      ai_cost_rates: {
        Row: {
          batch_discount: number;
          cache_read_rate: number;
          cache_write_rate: number;
          effective_from: string;
          id: string;
          input_rate: number;
          model: string;
          notes: string;
          output_rate: number;
          provider: string;
          unit: string;
        };
        ComputedFields: never;
        Insert: {
          batch_discount?: number;
          cache_read_rate?: number;
          cache_write_rate?: number;
          effective_from?: string;
          id?: string;
          input_rate: number;
          model: string;
          notes?: string;
          output_rate?: number;
          provider?: string;
          unit?: string;
        };
        Update: {
          batch_discount?: number;
          cache_read_rate?: number;
          cache_write_rate?: number;
          effective_from?: string;
          id?: string;
          input_rate?: number;
          model?: string;
          notes?: string;
          output_rate?: number;
          provider?: string;
          unit?: string;
        };
        Relationships: [];
      };
      ai_runs: {
        Row: {
          audio_seconds: number;
          batch: boolean;
          cache_read_tokens: number;
          cache_write_tokens: number;
          capability: string;
          case_id: string | null;
          client_id: string | null;
          cost_usd: number;
          created_at: string;
          created_by: string | null;
          document_id: string | null;
          duration_ms: number | null;
          error: string | null;
          id: string;
          input_tokens: number;
          job_id: string | null;
          model: string;
          org_id: string;
          output_tokens: number;
          prompt_version: string | null;
          provider: string;
          source: string | null;
          status: string;
          stop_reason: string | null;
        };
        ComputedFields: never;
        Insert: {
          audio_seconds?: number;
          batch?: boolean;
          cache_read_tokens?: number;
          cache_write_tokens?: number;
          capability: string;
          case_id?: string | null;
          client_id?: string | null;
          cost_usd?: number;
          created_at?: string;
          created_by?: string | null;
          document_id?: string | null;
          duration_ms?: number | null;
          error?: string | null;
          id?: string;
          input_tokens?: number;
          job_id?: string | null;
          model: string;
          org_id: string;
          output_tokens?: number;
          prompt_version?: string | null;
          provider?: string;
          source?: string | null;
          status?: string;
          stop_reason?: string | null;
        };
        Update: {
          audio_seconds?: number;
          batch?: boolean;
          cache_read_tokens?: number;
          cache_write_tokens?: number;
          capability?: string;
          case_id?: string | null;
          client_id?: string | null;
          cost_usd?: number;
          created_at?: string;
          created_by?: string | null;
          document_id?: string | null;
          duration_ms?: number | null;
          error?: string | null;
          id?: string;
          input_tokens?: number;
          job_id?: string | null;
          model?: string;
          org_id?: string;
          output_tokens?: number;
          prompt_version?: string | null;
          provider?: string;
          source?: string | null;
          status?: string;
          stop_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ai_runs_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_runs_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_suggestions: {
        Row: {
          capability: string;
          confidence: number | null;
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          decision: string;
          entity_id: string;
          entity_type: string;
          field_key: string | null;
          id: string;
          org_id: string;
          rationale: string | null;
          run_id: string | null;
          source_refs: NonNullable<Json>;
          value: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          capability: string;
          confidence?: number | null;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision?: string;
          entity_id: string;
          entity_type: string;
          field_key?: string | null;
          id?: string;
          org_id: string;
          rationale?: string | null;
          run_id?: string | null;
          source_refs?: NonNullable<Json>;
          value: NonNullable<Json>;
        };
        Update: {
          capability?: string;
          confidence?: number | null;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision?: string;
          entity_id?: string;
          entity_type?: string;
          field_key?: string | null;
          id?: string;
          org_id?: string;
          rationale?: string | null;
          run_id?: string | null;
          source_refs?: NonNullable<Json>;
          value?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: "ai_suggestions_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_suggestions_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "ai_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      assignment_events: {
        Row: {
          assigned_by: string | null;
          assigned_to: string | null;
          at: string;
          case_check_id: string | null;
          case_id: string;
          explanation: string | null;
          id: number;
          mode: string;
          org_id: string;
          previous_assignee: string | null;
          reason: string | null;
          score_breakdown: NonNullable<Json>;
          strategy: string | null;
        };
        ComputedFields: never;
        Insert: {
          assigned_by?: string | null;
          assigned_to?: string | null;
          at?: string;
          case_check_id?: string | null;
          case_id: string;
          explanation?: string | null;
          id?: never;
          mode: string;
          org_id: string;
          previous_assignee?: string | null;
          reason?: string | null;
          score_breakdown?: NonNullable<Json>;
          strategy?: string | null;
        };
        Update: {
          assigned_by?: string | null;
          assigned_to?: string | null;
          at?: string;
          case_check_id?: string | null;
          case_id?: string;
          explanation?: string | null;
          id?: never;
          mode?: string;
          org_id?: string;
          previous_assignee?: string | null;
          reason?: string | null;
          score_breakdown?: NonNullable<Json>;
          strategy?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "assignment_events_case_check_id_fkey";
            columns: ["case_check_id"];
            isOneToOne: false;
            referencedRelation: "case_checks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assignment_events_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assignment_events_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      assignment_rules: {
        Row: {
          assign_checks: boolean;
          consider_regions: boolean;
          consider_skills: boolean;
          org_id: string;
          strategy: string;
          updated_at: string;
          weights: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          assign_checks?: boolean;
          consider_regions?: boolean;
          consider_skills?: boolean;
          org_id: string;
          strategy?: string;
          updated_at?: string;
          weights?: NonNullable<Json>;
        };
        Update: {
          assign_checks?: boolean;
          consider_regions?: boolean;
          consider_skills?: boolean;
          org_id?: string;
          strategy?: string;
          updated_at?: string;
          weights?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: "assignment_rules_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: true;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          actor_id: string | null;
          actor_kind: string;
          after: Json | null;
          at: string;
          before: Json | null;
          changed_keys: string[];
          id: number;
          ip: string | null;
          op: string;
          org_id: string | null;
          row_id: string;
          table_name: string;
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          actor_kind?: string;
          after?: Json | null;
          at?: string;
          before?: Json | null;
          changed_keys?: string[];
          id?: never;
          ip?: string | null;
          op: string;
          org_id?: string | null;
          row_id: string;
          table_name: string;
        };
        Update: {
          actor_id?: string | null;
          actor_kind?: string;
          after?: Json | null;
          at?: string;
          before?: Json | null;
          changed_keys?: string[];
          id?: never;
          ip?: string | null;
          op?: string;
          org_id?: string | null;
          row_id?: string;
          table_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      candidate_links: {
        Row: {
          case_id: string;
          created_at: string;
          created_by: string | null;
          escalated_at: string | null;
          expires_at: string;
          first_opened_at: string | null;
          id: string;
          language: string;
          last_opened_at: string | null;
          last_reminded_at: string | null;
          open_count: number;
          org_id: string;
          reminders_sent: number;
          revoked_at: string | null;
          revoked_by: string | null;
          revoked_reason: string | null;
          sent_at: string | null;
          sent_count: number;
          sent_via: string[];
          token_enc: string | null;
          token_hash: string;
        };
        ComputedFields: never;
        Insert: {
          case_id: string;
          created_at?: string;
          created_by?: string | null;
          escalated_at?: string | null;
          expires_at: string;
          first_opened_at?: string | null;
          id?: string;
          language?: string;
          last_opened_at?: string | null;
          last_reminded_at?: string | null;
          open_count?: number;
          org_id: string;
          reminders_sent?: number;
          revoked_at?: string | null;
          revoked_by?: string | null;
          revoked_reason?: string | null;
          sent_at?: string | null;
          sent_count?: number;
          sent_via?: string[];
          token_enc?: string | null;
          token_hash: string;
        };
        Update: {
          case_id?: string;
          created_at?: string;
          created_by?: string | null;
          escalated_at?: string | null;
          expires_at?: string;
          first_opened_at?: string | null;
          id?: string;
          language?: string;
          last_opened_at?: string | null;
          last_reminded_at?: string | null;
          open_count?: number;
          org_id?: string;
          reminders_sent?: number;
          revoked_at?: string | null;
          revoked_by?: string | null;
          revoked_reason?: string | null;
          sent_at?: string | null;
          sent_count?: number;
          sent_via?: string[];
          token_enc?: string | null;
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "candidate_links_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_links_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      candidate_messages: {
        Row: {
          author_id: string | null;
          body: string;
          case_id: string;
          created_at: string;
          from_kind: string;
          id: string;
          org_id: string;
          read_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          author_id?: string | null;
          body: string;
          case_id: string;
          created_at?: string;
          from_kind: string;
          id?: string;
          org_id: string;
          read_at?: string | null;
        };
        Update: {
          author_id?: string | null;
          body?: string;
          case_id?: string;
          created_at?: string;
          from_kind?: string;
          id?: string;
          org_id?: string;
          read_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "candidate_messages_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_messages_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      candidate_requests: {
        Row: {
          answer: Json | null;
          answered_at: string | null;
          case_check_id: string | null;
          case_id: string;
          created_at: string;
          created_by: string | null;
          due_at: string | null;
          field_key: string | null;
          field_type: string | null;
          help: string | null;
          id: string;
          kind: string;
          options: NonNullable<Json>;
          org_id: string;
          reminders_sent: number;
          requirement_id: string | null;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          answer?: Json | null;
          answered_at?: string | null;
          case_check_id?: string | null;
          case_id: string;
          created_at?: string;
          created_by?: string | null;
          due_at?: string | null;
          field_key?: string | null;
          field_type?: string | null;
          help?: string | null;
          id?: string;
          kind: string;
          options?: NonNullable<Json>;
          org_id: string;
          reminders_sent?: number;
          requirement_id?: string | null;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          answer?: Json | null;
          answered_at?: string | null;
          case_check_id?: string | null;
          case_id?: string;
          created_at?: string;
          created_by?: string | null;
          due_at?: string | null;
          field_key?: string | null;
          field_type?: string | null;
          help?: string | null;
          id?: string;
          kind?: string;
          options?: NonNullable<Json>;
          org_id?: string;
          reminders_sent?: number;
          requirement_id?: string | null;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "candidate_requests_case_check_id_fkey";
            columns: ["case_check_id"];
            isOneToOne: false;
            referencedRelation: "case_checks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_requests_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_requests_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_requests_requirement_id_fkey";
            columns: ["requirement_id"];
            isOneToOne: false;
            referencedRelation: "case_check_requirements";
            referencedColumns: ["id"];
          },
        ];
      };
      candidates: {
        Row: {
          address: string | null;
          created_at: string;
          created_by: string | null;
          date_of_birth: string | null;
          district: string | null;
          email: string | null;
          full_name: string;
          gender: string | null;
          id: string;
          nic: string | null;
          nic_canonical: string | null;
          org_id: string;
          phone: string | null;
          preferred_language: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          address?: string | null;
          created_at?: string;
          created_by?: string | null;
          date_of_birth?: string | null;
          district?: string | null;
          email?: string | null;
          full_name: string;
          gender?: string | null;
          id?: string;
          nic?: string | null;
          nic_canonical?: string | null;
          org_id: string;
          phone?: string | null;
          preferred_language?: string;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          created_at?: string;
          created_by?: string | null;
          date_of_birth?: string | null;
          district?: string | null;
          email?: string | null;
          full_name?: string;
          gender?: string | null;
          id?: string;
          nic?: string | null;
          nic_canonical?: string | null;
          org_id?: string;
          phone?: string | null;
          preferred_language?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "candidates_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      case_check_requirements: {
        Row: {
          case_check_id: string | null;
          case_id: string;
          category: string;
          client_visible: boolean;
          created_at: string;
          description: string | null;
          id: string;
          label: string;
          min_count: number;
          org_id: string;
          received_count: number;
          requested_at: string | null;
          requested_by: string | null;
          requested_note: string | null;
          stage: string;
          status: string;
          updated_at: string;
          waived_at: string | null;
          waived_by: string | null;
          waived_reason: string | null;
        };
        ComputedFields: never;
        Insert: {
          case_check_id?: string | null;
          case_id: string;
          category: string;
          client_visible?: boolean;
          created_at?: string;
          description?: string | null;
          id?: string;
          label: string;
          min_count?: number;
          org_id: string;
          received_count?: number;
          requested_at?: string | null;
          requested_by?: string | null;
          requested_note?: string | null;
          stage?: string;
          status?: string;
          updated_at?: string;
          waived_at?: string | null;
          waived_by?: string | null;
          waived_reason?: string | null;
        };
        Update: {
          case_check_id?: string | null;
          case_id?: string;
          category?: string;
          client_visible?: boolean;
          created_at?: string;
          description?: string | null;
          id?: string;
          label?: string;
          min_count?: number;
          org_id?: string;
          received_count?: number;
          requested_at?: string | null;
          requested_by?: string | null;
          requested_note?: string | null;
          stage?: string;
          status?: string;
          updated_at?: string;
          waived_at?: string | null;
          waived_by?: string | null;
          waived_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "case_check_requirements_case_check_id_fkey";
            columns: ["case_check_id"];
            isOneToOne: false;
            referencedRelation: "case_checks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_check_requirements_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_check_requirements_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      case_checks: {
        Row: {
          assigned_at: string | null;
          assigned_to: string | null;
          case_id: string;
          check_type_id: string;
          check_type_version_id: string;
          client_note: string | null;
          completed_at: string | null;
          created_at: string;
          due_at: string | null;
          id: string;
          label: string;
          org_id: string;
          result: string | null;
          result_tone: string | null;
          sort: number;
          started_at: string | null;
          state: Database["public"]["Enums"]["check_state"];
          updated_at: string;
          updated_by: string | null;
          values: NonNullable<Json>;
          values_valid: boolean;
        };
        ComputedFields: never;
        Insert: {
          assigned_at?: string | null;
          assigned_to?: string | null;
          case_id: string;
          check_type_id: string;
          check_type_version_id: string;
          client_note?: string | null;
          completed_at?: string | null;
          created_at?: string;
          due_at?: string | null;
          id?: string;
          label: string;
          org_id: string;
          result?: string | null;
          result_tone?: string | null;
          sort?: number;
          started_at?: string | null;
          state?: Database["public"]["Enums"]["check_state"];
          updated_at?: string;
          updated_by?: string | null;
          values?: NonNullable<Json>;
          values_valid?: boolean;
        };
        Update: {
          assigned_at?: string | null;
          assigned_to?: string | null;
          case_id?: string;
          check_type_id?: string;
          check_type_version_id?: string;
          client_note?: string | null;
          completed_at?: string | null;
          created_at?: string;
          due_at?: string | null;
          id?: string;
          label?: string;
          org_id?: string;
          result?: string | null;
          result_tone?: string | null;
          sort?: number;
          started_at?: string | null;
          state?: Database["public"]["Enums"]["check_state"];
          updated_at?: string;
          updated_by?: string | null;
          values?: NonNullable<Json>;
          values_valid?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "case_checks_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_checks_check_type_id_fkey";
            columns: ["check_type_id"];
            isOneToOne: false;
            referencedRelation: "check_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_checks_check_type_version_id_fkey";
            columns: ["check_type_version_id"];
            isOneToOne: false;
            referencedRelation: "check_type_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_checks_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      case_counters: {
        Row: {
          org_id: string;
          value: number;
          year: number;
        };
        ComputedFields: never;
        Insert: {
          org_id: string;
          value?: number;
          year: number;
        };
        Update: {
          org_id?: string;
          value?: number;
          year?: number;
        };
        Relationships: [
          {
            foreignKeyName: "case_counters_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      case_events: {
        Row: {
          actor_id: string | null;
          at: string;
          body: string | null;
          case_check_id: string | null;
          case_id: string;
          data: NonNullable<Json>;
          id: number;
          kind: string;
          org_id: string;
          title: string;
          visible_to_candidate: boolean;
          visible_to_client: boolean;
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          at?: string;
          body?: string | null;
          case_check_id?: string | null;
          case_id: string;
          data?: NonNullable<Json>;
          id?: never;
          kind: string;
          org_id: string;
          title: string;
          visible_to_candidate?: boolean;
          visible_to_client?: boolean;
        };
        Update: {
          actor_id?: string | null;
          at?: string;
          body?: string | null;
          case_check_id?: string | null;
          case_id?: string;
          data?: NonNullable<Json>;
          id?: never;
          kind?: string;
          org_id?: string;
          title?: string;
          visible_to_candidate?: boolean;
          visible_to_client?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "case_events_case_check_id_fkey";
            columns: ["case_check_id"];
            isOneToOne: false;
            referencedRelation: "case_checks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_events_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "case_events_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      cases: {
        Row: {
          assigned_at: string | null;
          assigned_to: string | null;
          cancel_reason: string | null;
          cancelled_at: string | null;
          candidate_id: string;
          candidate_name: string;
          checks_done: number;
          checks_total: number;
          client_id: string;
          client_reference: string | null;
          client_visible: boolean;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          created_via: string;
          department: string | null;
          due_at: string | null;
          final_result: string | null;
          held_at: string | null;
          hold_reason: string | null;
          id: string;
          instructions: string | null;
          on_hold: boolean;
          org_id: string;
          package_id: string | null;
          package_snapshot: NonNullable<Json>;
          position_title: string | null;
          priority: string;
          process_type: Database["public"]["Enums"]["process_type"];
          proposed_result: string | null;
          received_at: string;
          reference: string;
          released_at: string | null;
          return_note: string | null;
          returned_at: string | null;
          stage: Database["public"]["Enums"]["case_stage"];
          status_key: string;
          updated_at: string;
          portal_case_row: Json | null;
        };
        ComputedFields: "portal_case_row";
        Insert: {
          assigned_at?: string | null;
          assigned_to?: string | null;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          candidate_id: string;
          candidate_name: string;
          checks_done?: number;
          checks_total?: number;
          client_id: string;
          client_reference?: string | null;
          client_visible?: boolean;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_via?: string;
          department?: string | null;
          due_at?: string | null;
          final_result?: string | null;
          held_at?: string | null;
          hold_reason?: string | null;
          id?: string;
          instructions?: string | null;
          on_hold?: boolean;
          org_id: string;
          package_id?: string | null;
          package_snapshot?: NonNullable<Json>;
          position_title?: string | null;
          priority?: string;
          process_type?: Database["public"]["Enums"]["process_type"];
          proposed_result?: string | null;
          received_at?: string;
          reference: string;
          released_at?: string | null;
          return_note?: string | null;
          returned_at?: string | null;
          stage?: Database["public"]["Enums"]["case_stage"];
          status_key?: string;
          updated_at?: string;
        };
        Update: {
          assigned_at?: string | null;
          assigned_to?: string | null;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          candidate_id?: string;
          candidate_name?: string;
          checks_done?: number;
          checks_total?: number;
          client_id?: string;
          client_reference?: string | null;
          client_visible?: boolean;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_via?: string;
          department?: string | null;
          due_at?: string | null;
          final_result?: string | null;
          held_at?: string | null;
          hold_reason?: string | null;
          id?: string;
          instructions?: string | null;
          on_hold?: boolean;
          org_id?: string;
          package_id?: string | null;
          package_snapshot?: NonNullable<Json>;
          position_title?: string | null;
          priority?: string;
          process_type?: Database["public"]["Enums"]["process_type"];
          proposed_result?: string | null;
          received_at?: string;
          reference?: string;
          released_at?: string | null;
          return_note?: string | null;
          returned_at?: string | null;
          stage?: Database["public"]["Enums"]["case_stage"];
          status_key?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cases_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cases_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cases_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cases_package_id_fkey";
            columns: ["package_id"];
            isOneToOne: false;
            referencedRelation: "packages";
            referencedColumns: ["id"];
          },
        ];
      };
      check_type_versions: {
        Row: {
          check_type_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          notes: string | null;
          org_id: string;
          published_at: string | null;
          published_by: string | null;
          schema: NonNullable<Json>;
          updated_at: string;
          version: number | null;
        };
        ComputedFields: never;
        Insert: {
          check_type_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          org_id: string;
          published_at?: string | null;
          published_by?: string | null;
          schema: NonNullable<Json>;
          updated_at?: string;
          version?: number | null;
        };
        Update: {
          check_type_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          org_id?: string;
          published_at?: string | null;
          published_by?: string | null;
          schema?: NonNullable<Json>;
          updated_at?: string;
          version?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "check_type_versions_check_type_id_fkey";
            columns: ["check_type_id"];
            isOneToOne: false;
            referencedRelation: "check_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "check_type_versions_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      check_types: {
        Row: {
          archived_at: string | null;
          created_at: string;
          created_by: string | null;
          current_version_id: string | null;
          description: string;
          draft_version_id: string | null;
          icon: string;
          id: string;
          is_builtin: boolean;
          key: string;
          name: string;
          org_id: string;
          sort: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_version_id?: string | null;
          description?: string;
          draft_version_id?: string | null;
          icon?: string;
          id?: string;
          is_builtin?: boolean;
          key: string;
          name: string;
          org_id: string;
          sort?: number;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_version_id?: string | null;
          description?: string;
          draft_version_id?: string | null;
          icon?: string;
          id?: string;
          is_builtin?: boolean;
          key?: string;
          name?: string;
          org_id?: string;
          sort?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "check_types_current_version_fk";
            columns: ["current_version_id"];
            isOneToOne: false;
            referencedRelation: "check_type_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "check_types_draft_version_fk";
            columns: ["draft_version_id"];
            isOneToOne: false;
            referencedRelation: "check_type_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "check_types_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      client_check_type_access: {
        Row: {
          check_type_id: string;
          client_id: string;
          enabled: boolean;
          org_id: string;
        };
        ComputedFields: never;
        Insert: {
          check_type_id: string;
          client_id: string;
          enabled?: boolean;
          org_id: string;
        };
        Update: {
          check_type_id?: string;
          client_id?: string;
          enabled?: boolean;
          org_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_check_type_access_check_type_id_fkey";
            columns: ["check_type_id"];
            isOneToOne: false;
            referencedRelation: "check_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_check_type_access_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_check_type_access_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      client_contacts: {
        Row: {
          client_id: string;
          created_at: string;
          email: string | null;
          id: string;
          is_primary: boolean;
          name: string;
          org_id: string;
          phone: string | null;
          receives_invoices: boolean;
          receives_reports: boolean;
          title: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          client_id: string;
          created_at?: string;
          email?: string | null;
          id?: string;
          is_primary?: boolean;
          name: string;
          org_id: string;
          phone?: string | null;
          receives_invoices?: boolean;
          receives_reports?: boolean;
          title?: string | null;
          updated_at?: string;
        };
        Update: {
          client_id?: string;
          created_at?: string;
          email?: string | null;
          id?: string;
          is_primary?: boolean;
          name?: string;
          org_id?: string;
          phone?: string | null;
          receives_invoices?: boolean;
          receives_reports?: boolean;
          title?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_contacts_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_contacts_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      client_settings: {
        Row: {
          client_id: string;
          notifications: NonNullable<Json>;
          org_id: string;
          portal: NonNullable<Json>;
          updated_at: string;
          visibility: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          client_id: string;
          notifications?: NonNullable<Json>;
          org_id: string;
          portal?: NonNullable<Json>;
          updated_at?: string;
          visibility?: NonNullable<Json>;
        };
        Update: {
          client_id?: string;
          notifications?: NonNullable<Json>;
          org_id?: string;
          portal?: NonNullable<Json>;
          updated_at?: string;
          visibility?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: "client_settings_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: true;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_settings_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      client_status_catalog: {
        Row: {
          candidate_label: string;
          client_label: string;
          id: string;
          internal_label: string;
          key: string;
          org_id: string;
          sort: number;
          stage: Database["public"]["Enums"]["case_stage"];
        };
        ComputedFields: never;
        Insert: {
          candidate_label: string;
          client_label: string;
          id?: string;
          internal_label: string;
          key: string;
          org_id: string;
          sort?: number;
          stage: Database["public"]["Enums"]["case_stage"];
        };
        Update: {
          candidate_label?: string;
          client_label?: string;
          id?: string;
          internal_label?: string;
          key?: string;
          org_id?: string;
          sort?: number;
          stage?: Database["public"]["Enums"]["case_stage"];
        };
        Relationships: [
          {
            foreignKeyName: "client_status_catalog_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      clients: {
        Row: {
          address: NonNullable<Json>;
          ai_opt_out: boolean;
          billing_policy: string;
          code: string;
          created_at: string;
          created_by: string | null;
          default_package_id: string | null;
          default_template: string;
          email: string | null;
          id: string;
          industry: string | null;
          legal_name: string | null;
          name: string;
          notes: string | null;
          org_id: string;
          payment_terms_days: number;
          phone: string | null;
          registration_no: string | null;
          sla_days: number;
          status: string;
          updated_at: string;
          vat_no: string | null;
          website: string | null;
        };
        ComputedFields: never;
        Insert: {
          address?: NonNullable<Json>;
          ai_opt_out?: boolean;
          billing_policy?: string;
          code: string;
          created_at?: string;
          created_by?: string | null;
          default_package_id?: string | null;
          default_template?: string;
          email?: string | null;
          id?: string;
          industry?: string | null;
          legal_name?: string | null;
          name: string;
          notes?: string | null;
          org_id: string;
          payment_terms_days?: number;
          phone?: string | null;
          registration_no?: string | null;
          sla_days?: number;
          status?: string;
          updated_at?: string;
          vat_no?: string | null;
          website?: string | null;
        };
        Update: {
          address?: NonNullable<Json>;
          ai_opt_out?: boolean;
          billing_policy?: string;
          code?: string;
          created_at?: string;
          created_by?: string | null;
          default_package_id?: string | null;
          default_template?: string;
          email?: string | null;
          id?: string;
          industry?: string | null;
          legal_name?: string | null;
          name?: string;
          notes?: string | null;
          org_id?: string;
          payment_terms_days?: number;
          phone?: string | null;
          registration_no?: string | null;
          sla_days?: number;
          status?: string;
          updated_at?: string;
          vat_no?: string | null;
          website?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "clients_default_package_fk";
            columns: ["default_package_id"];
            isOneToOne: false;
            referencedRelation: "packages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "clients_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      communications: {
        Row: {
          body: string;
          case_id: string | null;
          channel: string;
          client_id: string | null;
          counterparty: string | null;
          created_at: string;
          created_by: string | null;
          direction: string;
          email_outbox_id: string | null;
          external_id: string | null;
          id: string;
          org_id: string;
          sms_outbox_id: string | null;
          status: string;
          subject: string | null;
          template_key: string | null;
          visible_to_client: boolean;
        };
        ComputedFields: never;
        Insert: {
          body?: string;
          case_id?: string | null;
          channel: string;
          client_id?: string | null;
          counterparty?: string | null;
          created_at?: string;
          created_by?: string | null;
          direction: string;
          email_outbox_id?: string | null;
          external_id?: string | null;
          id?: string;
          org_id: string;
          sms_outbox_id?: string | null;
          status?: string;
          subject?: string | null;
          template_key?: string | null;
          visible_to_client?: boolean;
        };
        Update: {
          body?: string;
          case_id?: string | null;
          channel?: string;
          client_id?: string | null;
          counterparty?: string | null;
          created_at?: string;
          created_by?: string | null;
          direction?: string;
          email_outbox_id?: string | null;
          external_id?: string | null;
          id?: string;
          org_id?: string;
          sms_outbox_id?: string | null;
          status?: string;
          subject?: string | null;
          template_key?: string | null;
          visible_to_client?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "communications_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "communications_email_outbox_id_fkey";
            columns: ["email_outbox_id"];
            isOneToOne: false;
            referencedRelation: "email_outbox";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "communications_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "communications_sms_outbox_id_fkey";
            columns: ["sms_outbox_id"];
            isOneToOne: false;
            referencedRelation: "sms_outbox";
            referencedColumns: ["id"];
          },
        ];
      };
      consent_forms: {
        Row: {
          ai_check: NonNullable<Json>;
          case_id: string;
          created_at: string;
          document_id: string | null;
          form_version: string;
          id: string;
          ip: string | null;
          method: string | null;
          org_id: string;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          signed_at: string | null;
          signed_name: string | null;
          status: string;
          updated_at: string;
          user_agent: string | null;
        };
        ComputedFields: never;
        Insert: {
          ai_check?: NonNullable<Json>;
          case_id: string;
          created_at?: string;
          document_id?: string | null;
          form_version?: string;
          id?: string;
          ip?: string | null;
          method?: string | null;
          org_id: string;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          signed_at?: string | null;
          signed_name?: string | null;
          status?: string;
          updated_at?: string;
          user_agent?: string | null;
        };
        Update: {
          ai_check?: NonNullable<Json>;
          case_id?: string;
          created_at?: string;
          document_id?: string | null;
          form_version?: string;
          id?: string;
          ip?: string | null;
          method?: string | null;
          org_id?: string;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          signed_at?: string | null;
          signed_name?: string | null;
          status?: string;
          updated_at?: string;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "consent_forms_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: true;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "consent_forms_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "consent_forms_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      document_access_log: {
        Row: {
          action: string;
          at: string;
          document_id: string;
          id: number;
          ip: string | null;
          org_id: string;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          action?: string;
          at?: string;
          document_id: string;
          id?: never;
          ip?: string | null;
          org_id: string;
          user_id?: string | null;
        };
        Update: {
          action?: string;
          at?: string;
          document_id?: string;
          id?: never;
          ip?: string | null;
          org_id?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "document_access_log_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_access_log_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      document_ai: {
        Row: {
          classification: NonNullable<Json>;
          created_at: string;
          document_id: string;
          org_id: string;
          quality: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          classification?: NonNullable<Json>;
          created_at?: string;
          document_id: string;
          org_id: string;
          quality?: NonNullable<Json>;
        };
        Update: {
          classification?: NonNullable<Json>;
          created_at?: string;
          document_id?: string;
          org_id?: string;
          quality?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: "document_ai_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: true;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_ai_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      document_categories: {
        Row: {
          created_at: string;
          guide: string;
          id: string;
          is_active: boolean;
          key: string;
          name: string;
          org_id: string;
          sensitive: boolean;
          sort: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          guide?: string;
          id?: string;
          is_active?: boolean;
          key: string;
          name: string;
          org_id: string;
          sensitive?: boolean;
          sort?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          guide?: string;
          id?: string;
          is_active?: boolean;
          key?: string;
          name?: string;
          org_id?: string;
          sensitive?: boolean;
          sort?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_categories_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      document_counters: {
        Row: {
          kind: string;
          last_value: number;
          org_id: string;
          year: number;
        };
        ComputedFields: never;
        Insert: {
          kind: string;
          last_value?: number;
          org_id: string;
          year: number;
        };
        Update: {
          kind?: string;
          last_value?: number;
          org_id?: string;
          year?: number;
        };
        Relationships: [
          {
            foreignKeyName: "document_counters_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      document_series: {
        Row: {
          kind: string;
          org_id: string;
          padding: number;
          prefix: string;
          yearly_reset: boolean;
        };
        ComputedFields: never;
        Insert: {
          kind: string;
          org_id: string;
          padding?: number;
          prefix: string;
          yearly_reset?: boolean;
        };
        Update: {
          kind?: string;
          org_id?: string;
          padding?: number;
          prefix?: string;
          yearly_reset?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "document_series_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      document_templates: {
        Row: {
          created_at: string;
          description: string;
          id: string;
          is_default: boolean;
          key: string;
          name: string;
          org_id: string;
          settings: NonNullable<Json>;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          description?: string;
          id?: string;
          is_default?: boolean;
          key: string;
          name: string;
          org_id: string;
          settings?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string;
          id?: string;
          is_default?: boolean;
          key?: string;
          name?: string;
          org_id?: string;
          settings?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_templates_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      document_texts: {
        Row: {
          created_at: string;
          document_id: string;
          language: string | null;
          org_id: string;
          text: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          document_id: string;
          language?: string | null;
          org_id: string;
          text?: string;
        };
        Update: {
          created_at?: string;
          document_id?: string;
          language?: string | null;
          org_id?: string;
          text?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_texts_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: true;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_texts_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      documents: {
        Row: {
          candidate_id: string | null;
          case_check_id: string | null;
          case_id: string;
          category: string;
          client_id: string | null;
          created_at: string;
          filename: string;
          id: string;
          label: string | null;
          mime: string;
          org_id: string;
          parent_id: string | null;
          rejection_reason: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          sensitive: boolean;
          sha256: string | null;
          size_bytes: number;
          status: string;
          storage_bucket: string;
          storage_path: string;
          updated_at: string;
          uploaded_by: string | null;
          uploaded_by_kind: string;
          version: number;
          visibility: string;
        };
        ComputedFields: never;
        Insert: {
          candidate_id?: string | null;
          case_check_id?: string | null;
          case_id: string;
          category: string;
          client_id?: string | null;
          created_at?: string;
          filename: string;
          id?: string;
          label?: string | null;
          mime: string;
          org_id: string;
          parent_id?: string | null;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sensitive?: boolean;
          sha256?: string | null;
          size_bytes?: number;
          status?: string;
          storage_bucket?: string;
          storage_path: string;
          updated_at?: string;
          uploaded_by?: string | null;
          uploaded_by_kind?: string;
          version?: number;
          visibility?: string;
        };
        Update: {
          candidate_id?: string | null;
          case_check_id?: string | null;
          case_id?: string;
          category?: string;
          client_id?: string | null;
          created_at?: string;
          filename?: string;
          id?: string;
          label?: string | null;
          mime?: string;
          org_id?: string;
          parent_id?: string | null;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          sensitive?: boolean;
          sha256?: string | null;
          size_bytes?: number;
          status?: string;
          storage_bucket?: string;
          storage_path?: string;
          updated_at?: string;
          uploaded_by?: string | null;
          uploaded_by_kind?: string;
          version?: number;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: "documents_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_case_check_id_fkey";
            columns: ["case_check_id"];
            isOneToOne: false;
            referencedRelation: "case_checks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      email_outbox: {
        Row: {
          attachments: NonNullable<Json>;
          attempts: number;
          cc_emails: string[];
          created_at: string;
          created_by: string | null;
          entity_id: string | null;
          entity_type: string | null;
          html: string;
          id: string;
          last_error: string | null;
          org_id: string;
          payload: NonNullable<Json>;
          provider_id: string | null;
          reply_to: string | null;
          sent_at: string | null;
          status: string;
          subject: string;
          template_key: string | null;
          text_body: string | null;
          to_emails: string[];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          attachments?: NonNullable<Json>;
          attempts?: number;
          cc_emails?: string[];
          created_at?: string;
          created_by?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          html: string;
          id?: string;
          last_error?: string | null;
          org_id: string;
          payload?: NonNullable<Json>;
          provider_id?: string | null;
          reply_to?: string | null;
          sent_at?: string | null;
          status?: string;
          subject: string;
          template_key?: string | null;
          text_body?: string | null;
          to_emails: string[];
          updated_at?: string;
        };
        Update: {
          attachments?: NonNullable<Json>;
          attempts?: number;
          cc_emails?: string[];
          created_at?: string;
          created_by?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          html?: string;
          id?: string;
          last_error?: string | null;
          org_id?: string;
          payload?: NonNullable<Json>;
          provider_id?: string | null;
          reply_to?: string | null;
          sent_at?: string | null;
          status?: string;
          subject?: string;
          template_key?: string | null;
          text_body?: string | null;
          to_emails?: string[];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "email_outbox_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      generated_documents: {
        Row: {
          created_at: string;
          created_by: string | null;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          job_id: string | null;
          kind: string;
          org_id: string;
          page_count: number | null;
          sha256: string | null;
          size_bytes: number | null;
          status: string;
          storage_path: string | null;
          template_key: string | null;
          title: string;
          updated_at: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          job_id?: string | null;
          kind: string;
          org_id: string;
          page_count?: number | null;
          sha256?: string | null;
          size_bytes?: number | null;
          status?: string;
          storage_path?: string | null;
          template_key?: string | null;
          title?: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          job_id?: string | null;
          kind?: string;
          org_id?: string;
          page_count?: number | null;
          sha256?: string | null;
          size_bytes?: number | null;
          status?: string;
          storage_path?: string | null;
          template_key?: string | null;
          title?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "generated_documents_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "generated_documents_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      invitations: {
        Row: {
          accepted_at: string | null;
          auth_user_id: string | null;
          client_id: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          full_name: string;
          id: string;
          invited_by: string | null;
          kind: Database["public"]["Enums"]["member_kind"];
          last_sent_at: string | null;
          org_id: string;
          role_id: string;
          sent_count: number;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string | null;
          auth_user_id?: string | null;
          client_id?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          full_name?: string;
          id?: string;
          invited_by?: string | null;
          kind: Database["public"]["Enums"]["member_kind"];
          last_sent_at?: string | null;
          org_id: string;
          role_id: string;
          sent_count?: number;
          status?: string;
        };
        Update: {
          accepted_at?: string | null;
          auth_user_id?: string | null;
          client_id?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          full_name?: string;
          id?: string;
          invited_by?: string | null;
          kind?: Database["public"]["Enums"]["member_kind"];
          last_sent_at?: string | null;
          org_id?: string;
          role_id?: string;
          sent_count?: number;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_client_fk";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invitations_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invitations_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
        ];
      };
      job_failures: {
        Row: {
          at: string;
          attempt: number;
          error: string;
          id: number;
          job_id: string;
        };
        ComputedFields: never;
        Insert: {
          at?: string;
          attempt: number;
          error: string;
          id?: never;
          job_id: string;
        };
        Update: {
          at?: string;
          attempt?: number;
          error?: string;
          id?: never;
          job_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_failures_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      job_kind_limits: {
        Row: {
          default_max_attempts: number;
          default_priority: number;
          description: string;
          kind: string;
          max_running: number;
        };
        ComputedFields: never;
        Insert: {
          default_max_attempts?: number;
          default_priority?: number;
          description?: string;
          kind: string;
          max_running?: number;
        };
        Update: {
          default_max_attempts?: number;
          default_priority?: number;
          description?: string;
          kind?: string;
          max_running?: number;
        };
        Relationships: [];
      };
      job_workers: {
        Row: {
          heartbeat_at: string;
          jobs_done: number;
          started_at: string;
          worker_id: string;
        };
        ComputedFields: never;
        Insert: {
          heartbeat_at?: string;
          jobs_done?: number;
          started_at?: string;
          worker_id: string;
        };
        Update: {
          heartbeat_at?: string;
          jobs_done?: number;
          started_at?: string;
          worker_id?: string;
        };
        Relationships: [];
      };
      jobs: {
        Row: {
          attempts: number;
          claims: number;
          created_at: string;
          created_by: string | null;
          entity_id: string | null;
          entity_type: string | null;
          finished_at: string | null;
          id: string;
          idempotency_key: string | null;
          kind: string;
          last_error: string | null;
          locked_at: string | null;
          locked_by: string | null;
          locked_until: string | null;
          max_attempts: number;
          org_id: string;
          payload: NonNullable<Json>;
          priority: number;
          progress: Json | null;
          result: Json | null;
          run_after: string;
          status: Database["public"]["Enums"]["job_status"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          claims?: number;
          created_at?: string;
          created_by?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          finished_at?: string | null;
          id?: string;
          idempotency_key?: string | null;
          kind: string;
          last_error?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          locked_until?: string | null;
          max_attempts?: number;
          org_id: string;
          payload?: NonNullable<Json>;
          priority?: number;
          progress?: Json | null;
          result?: Json | null;
          run_after?: string;
          status?: Database["public"]["Enums"]["job_status"];
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          claims?: number;
          created_at?: string;
          created_by?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          finished_at?: string | null;
          id?: string;
          idempotency_key?: string | null;
          kind?: string;
          last_error?: string | null;
          locked_at?: string | null;
          locked_by?: string | null;
          locked_until?: string | null;
          max_attempts?: number;
          org_id?: string;
          payload?: NonNullable<Json>;
          priority?: number;
          progress?: Json | null;
          result?: Json | null;
          run_after?: string;
          status?: Database["public"]["Enums"]["job_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "jobs_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      memberships: {
        Row: {
          activated_at: string | null;
          client_id: string | null;
          created_at: string;
          id: string;
          invited_at: string | null;
          invited_by: string | null;
          kind: Database["public"]["Enums"]["member_kind"];
          org_id: string;
          role_id: string;
          status: Database["public"]["Enums"]["member_status"];
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          activated_at?: string | null;
          client_id?: string | null;
          created_at?: string;
          id?: string;
          invited_at?: string | null;
          invited_by?: string | null;
          kind: Database["public"]["Enums"]["member_kind"];
          org_id: string;
          role_id: string;
          status?: Database["public"]["Enums"]["member_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          activated_at?: string | null;
          client_id?: string | null;
          created_at?: string;
          id?: string;
          invited_at?: string | null;
          invited_by?: string | null;
          kind?: Database["public"]["Enums"]["member_kind"];
          org_id?: string;
          role_id?: string;
          status?: Database["public"]["Enums"]["member_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_client_fk";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memberships_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memberships_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_prefs: {
        Row: {
          digest: string;
          matrix: NonNullable<Json>;
          quiet_hours: NonNullable<Json>;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          digest?: string;
          matrix?: NonNullable<Json>;
          quiet_hours?: NonNullable<Json>;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          digest?: string;
          matrix?: NonNullable<Json>;
          quiet_hours?: NonNullable<Json>;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          body: string;
          created_at: string;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          link: string | null;
          org_id: string;
          read_at: string | null;
          title: string;
          type: string;
          urgent: boolean;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          body?: string;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          link?: string | null;
          org_id: string;
          read_at?: string | null;
          title: string;
          type: string;
          urgent?: boolean;
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          link?: string | null;
          org_id?: string;
          read_at?: string | null;
          title?: string;
          type?: string;
          urgent?: boolean;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      orgs: {
        Row: {
          branding: NonNullable<Json>;
          created_at: string;
          currency: string;
          id: string;
          mfa_required_for_staff: boolean;
          name: string;
          settings: NonNullable<Json>;
          slug: string;
          timezone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          branding?: NonNullable<Json>;
          created_at?: string;
          currency?: string;
          id?: string;
          mfa_required_for_staff?: boolean;
          name: string;
          settings?: NonNullable<Json>;
          slug: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          branding?: NonNullable<Json>;
          created_at?: string;
          currency?: string;
          id?: string;
          mfa_required_for_staff?: boolean;
          name?: string;
          settings?: NonNullable<Json>;
          slug?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      package_client_visibility: {
        Row: {
          client_id: string;
          org_id: string;
          package_id: string;
        };
        ComputedFields: never;
        Insert: {
          client_id: string;
          org_id: string;
          package_id: string;
        };
        Update: {
          client_id?: string;
          org_id?: string;
          package_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "package_client_visibility_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "package_client_visibility_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "package_client_visibility_package_id_fkey";
            columns: ["package_id"];
            isOneToOne: false;
            referencedRelation: "packages";
            referencedColumns: ["id"];
          },
        ];
      };
      package_items: {
        Row: {
          check_type_id: string;
          id: string;
          org_id: string;
          package_id: string;
          sort: number;
          unit_price: number;
        };
        ComputedFields: never;
        Insert: {
          check_type_id: string;
          id?: string;
          org_id: string;
          package_id: string;
          sort?: number;
          unit_price?: number;
        };
        Update: {
          check_type_id?: string;
          id?: string;
          org_id?: string;
          package_id?: string;
          sort?: number;
          unit_price?: number;
        };
        Relationships: [
          {
            foreignKeyName: "package_items_check_type_id_fkey";
            columns: ["check_type_id"];
            isOneToOne: false;
            referencedRelation: "check_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "package_items_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "package_items_package_id_fkey";
            columns: ["package_id"];
            isOneToOne: false;
            referencedRelation: "packages";
            referencedColumns: ["id"];
          },
        ];
      };
      packages: {
        Row: {
          client_id: string | null;
          code: string;
          created_at: string;
          created_by: string | null;
          currency: string;
          default_process_type: Database["public"]["Enums"]["process_type"];
          description: string;
          fixed_price: number | null;
          id: string;
          is_active: boolean;
          name: string;
          needs_approval: boolean;
          org_id: string;
          owner_scope: string;
          pricing_mode: string;
          sort: number;
          tat_days: number;
          updated_at: string;
          visibility: string;
        };
        ComputedFields: never;
        Insert: {
          client_id?: string | null;
          code: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          default_process_type?: Database["public"]["Enums"]["process_type"];
          description?: string;
          fixed_price?: number | null;
          id?: string;
          is_active?: boolean;
          name: string;
          needs_approval?: boolean;
          org_id: string;
          owner_scope?: string;
          pricing_mode?: string;
          sort?: number;
          tat_days?: number;
          updated_at?: string;
          visibility?: string;
        };
        Update: {
          client_id?: string | null;
          code?: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          default_process_type?: Database["public"]["Enums"]["process_type"];
          description?: string;
          fixed_price?: number | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          needs_approval?: boolean;
          org_id?: string;
          owner_scope?: string;
          pricing_mode?: string;
          sort?: number;
          tat_days?: number;
          updated_at?: string;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: "packages_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "packages_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      permissions: {
        Row: {
          description: string;
          grantable: boolean;
          group_key: string;
          key: string;
          kind: Database["public"]["Enums"]["member_kind"];
          label: string;
          sort: number;
        };
        ComputedFields: never;
        Insert: {
          description?: string;
          grantable?: boolean;
          group_key: string;
          key: string;
          kind: Database["public"]["Enums"]["member_kind"];
          label: string;
          sort?: number;
        };
        Update: {
          description?: string;
          grantable?: boolean;
          group_key?: string;
          key?: string;
          kind?: Database["public"]["Enums"]["member_kind"];
          label?: string;
          sort?: number;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_path: string | null;
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          last_seen_at: string | null;
          locale: string;
          phone: string | null;
          title: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          avatar_path?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string;
          id: string;
          last_seen_at?: string | null;
          locale?: string;
          phone?: string | null;
          title?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_path?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          last_seen_at?: string | null;
          locale?: string;
          phone?: string | null;
          title?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      qc_reviews: {
        Row: {
          case_id: string;
          checklist: NonNullable<Json>;
          created_at: string;
          decision: string;
          id: string;
          kind: string;
          org_id: string;
          remarks: string | null;
          returned_check_ids: string[];
          reviewer_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          case_id: string;
          checklist?: NonNullable<Json>;
          created_at?: string;
          decision: string;
          id?: string;
          kind: string;
          org_id: string;
          remarks?: string | null;
          returned_check_ids?: string[];
          reviewer_id?: string | null;
        };
        Update: {
          case_id?: string;
          checklist?: NonNullable<Json>;
          created_at?: string;
          decision?: string;
          id?: string;
          kind?: string;
          org_id?: string;
          remarks?: string | null;
          returned_check_ids?: string[];
          reviewer_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "qc_reviews_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "qc_reviews_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limit_hits: {
        Row: {
          hits: number;
          key: string;
          window_start: string;
        };
        ComputedFields: never;
        Insert: {
          hits?: number;
          key: string;
          window_start: string;
        };
        Update: {
          hits?: number;
          key?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      request_templates: {
        Row: {
          client_id: string | null;
          created_at: string;
          created_by: string | null;
          defaults: NonNullable<Json>;
          description: string;
          id: string;
          is_active: boolean;
          is_favourite: boolean;
          last_used_at: string | null;
          name: string;
          org_id: string;
          owner_scope: string;
          package_id: string;
          priority: string;
          process_type: Database["public"]["Enums"]["process_type"];
          updated_at: string;
          usage_count: number;
        };
        ComputedFields: never;
        Insert: {
          client_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          defaults?: NonNullable<Json>;
          description?: string;
          id?: string;
          is_active?: boolean;
          is_favourite?: boolean;
          last_used_at?: string | null;
          name: string;
          org_id: string;
          owner_scope?: string;
          package_id: string;
          priority?: string;
          process_type?: Database["public"]["Enums"]["process_type"];
          updated_at?: string;
          usage_count?: number;
        };
        Update: {
          client_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          defaults?: NonNullable<Json>;
          description?: string;
          id?: string;
          is_active?: boolean;
          is_favourite?: boolean;
          last_used_at?: string | null;
          name?: string;
          org_id?: string;
          owner_scope?: string;
          package_id?: string;
          priority?: string;
          process_type?: Database["public"]["Enums"]["process_type"];
          updated_at?: string;
          usage_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "request_templates_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "request_templates_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "request_templates_package_id_fkey";
            columns: ["package_id"];
            isOneToOne: false;
            referencedRelation: "packages";
            referencedColumns: ["id"];
          },
        ];
      };
      role_permissions: {
        Row: {
          permission: string;
          role_id: string;
        };
        ComputedFields: never;
        Insert: {
          permission: string;
          role_id: string;
        };
        Update: {
          permission?: string;
          role_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_fkey";
            columns: ["permission"];
            isOneToOne: false;
            referencedRelation: "permissions";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
        ];
      };
      roles: {
        Row: {
          created_at: string;
          description: string;
          id: string;
          is_system: boolean;
          key: string;
          kind: Database["public"]["Enums"]["member_kind"];
          name: string;
          org_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          description?: string;
          id?: string;
          is_system?: boolean;
          key: string;
          kind: Database["public"]["Enums"]["member_kind"];
          name: string;
          org_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string;
          id?: string;
          is_system?: boolean;
          key?: string;
          kind?: Database["public"]["Enums"]["member_kind"];
          name?: string;
          org_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "roles_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_views: {
        Row: {
          created_at: string;
          entity: string;
          id: string;
          name: string;
          org_id: string;
          owner_id: string;
          query: string;
          shared: boolean;
          sort: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          entity?: string;
          id?: string;
          name: string;
          org_id: string;
          owner_id: string;
          query?: string;
          shared?: boolean;
          sort?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          entity?: string;
          id?: string;
          name?: string;
          org_id?: string;
          owner_id?: string;
          query?: string;
          shared?: boolean;
          sort?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_views_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      sms_outbox: {
        Row: {
          attempts: number;
          body: string;
          created_at: string;
          created_by: string | null;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          last_error: string | null;
          org_id: string;
          provider_id: string | null;
          segments: number | null;
          sent_at: string | null;
          status: string;
          template_key: string | null;
          to_phone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          body: string;
          created_at?: string;
          created_by?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          last_error?: string | null;
          org_id: string;
          provider_id?: string | null;
          segments?: number | null;
          sent_at?: string | null;
          status?: string;
          template_key?: string | null;
          to_phone: string;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          body?: string;
          created_at?: string;
          created_by?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          last_error?: string | null;
          org_id?: string;
          provider_id?: string | null;
          segments?: number | null;
          sent_at?: string | null;
          status?: string;
          template_key?: string | null;
          to_phone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sms_outbox_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      staff_availability: {
        Row: {
          created_at: string;
          created_by: string | null;
          ends_on: string;
          id: string;
          kind: string;
          note: string | null;
          org_id: string;
          starts_on: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          ends_on: string;
          id?: string;
          kind?: string;
          note?: string | null;
          org_id: string;
          starts_on: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          ends_on?: string;
          id?: string;
          kind?: string;
          note?: string | null;
          org_id?: string;
          starts_on?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_availability_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      staff_capacity: {
        Row: {
          auto_assign: boolean;
          max_open_cases: number;
          max_open_checks: number;
          org_id: string;
          regions: string[];
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          auto_assign?: boolean;
          max_open_cases?: number;
          max_open_checks?: number;
          org_id: string;
          regions?: string[];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          auto_assign?: boolean;
          max_open_cases?: number;
          max_open_checks?: number;
          org_id?: string;
          regions?: string[];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_capacity_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      staff_skills: {
        Row: {
          check_type_id: string;
          level: string;
          org_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          check_type_id: string;
          level?: string;
          org_id: string;
          user_id: string;
        };
        Update: {
          check_type_id?: string;
          level?: string;
          org_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_skills_check_type_id_fkey";
            columns: ["check_type_id"];
            isOneToOne: false;
            referencedRelation: "check_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_skills_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      stage_history: {
        Row: {
          actor_id: string | null;
          at: string;
          case_id: string;
          event: string;
          from_stage: Database["public"]["Enums"]["case_stage"] | null;
          id: number;
          org_id: string;
          reason: string | null;
          to_stage: Database["public"]["Enums"]["case_stage"];
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          at?: string;
          case_id: string;
          event: string;
          from_stage?: Database["public"]["Enums"]["case_stage"] | null;
          id?: never;
          org_id: string;
          reason?: string | null;
          to_stage: Database["public"]["Enums"]["case_stage"];
        };
        Update: {
          actor_id?: string | null;
          at?: string;
          case_id?: string;
          event?: string;
          from_stage?: Database["public"]["Enums"]["case_stage"] | null;
          id?: never;
          org_id?: string;
          reason?: string | null;
          to_stage?: Database["public"]["Enums"]["case_stage"];
        };
        Relationships: [
          {
            foreignKeyName: "stage_history_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stage_history_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      system_events: {
        Row: {
          context: NonNullable<Json>;
          fingerprint: string | null;
          first_at: string;
          id: number;
          kind: string;
          last_at: string;
          message: string;
          occurrences: number;
          org_id: string | null;
          severity: string;
        };
        ComputedFields: never;
        Insert: {
          context?: NonNullable<Json>;
          fingerprint?: string | null;
          first_at?: string;
          id?: never;
          kind: string;
          last_at?: string;
          message: string;
          occurrences?: number;
          org_id?: string | null;
          severity?: string;
        };
        Update: {
          context?: NonNullable<Json>;
          fingerprint?: string | null;
          first_at?: string;
          id?: never;
          kind?: string;
          last_at?: string;
          message?: string;
          occurrences?: number;
          org_id?: string | null;
          severity?: string;
        };
        Relationships: [
          {
            foreignKeyName: "system_events_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          assignee_id: string | null;
          auto_generated: boolean;
          case_id: string | null;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          description: string;
          due_at: string | null;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          org_id: string;
          priority: string;
          status: string;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          assignee_id?: string | null;
          auto_generated?: boolean;
          case_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          due_at?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          org_id: string;
          priority?: string;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          assignee_id?: string | null;
          auto_generated?: boolean;
          case_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          due_at?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          org_id?: string;
          priority?: string;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
      templates: {
        Row: {
          active: boolean;
          body: string;
          created_at: string;
          id: string;
          is_system: boolean;
          key: string;
          kind: string;
          language: string;
          name: string;
          org_id: string;
          subject: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          body: string;
          created_at?: string;
          id?: string;
          is_system?: boolean;
          key: string;
          kind: string;
          language?: string;
          name: string;
          org_id: string;
          subject?: string | null;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          body?: string;
          created_at?: string;
          id?: string;
          is_system?: boolean;
          key?: string;
          kind?: string;
          language?: string;
          name?: string;
          org_id?: string;
          subject?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "templates_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "orgs";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_my_invitation: { Args: Record<PropertyKey, never>; Returns: boolean };
      add_case_note: {
        Args: { p_body: string; p_case: string; p_check: string };
        Returns: undefined;
      };
      add_working_days: { Args: { p_days: number; p_from: string }; Returns: string };
      ai_cost_summary: {
        Args: { p_from: string; p_group?: string; p_to: string };
        Returns: {
          cost_usd: number;
          group_key: string;
          input_tokens: number;
          output_tokens: number;
          runs: number;
        }[];
      };
      apply_auto_assignment: { Args: { p_case: string; p_plan: Json }; Returns: Json };
      assign_case: {
        Args: { p_case: string; p_include_checks?: boolean; p_reason?: string; p_user: string };
        Returns: undefined;
      };
      assign_check: {
        Args: { p_check: string; p_reason?: string; p_user: string };
        Returns: undefined;
      };
      attach_audit: { Args: { p_keys?: string; p_table: unknown }; Returns: undefined };
      auth_org_id: { Args: Record<PropertyKey, never>; Returns: string };
      begin_document_upload: {
        Args: {
          p_case: string;
          p_category: string;
          p_check: string;
          p_filename: string;
          p_label?: string;
          p_mime: string;
          p_parent?: string;
          p_size: number;
        };
        Returns: Json;
      };
      can_manage_candidate: { Args: { p_case: string }; Returns: boolean };
      cancel_case: { Args: { p_case: string; p_reason: string }; Returns: undefined };
      candidate_answer_request: {
        Args: { p_answer: Json; p_link: string; p_request: string };
        Returns: undefined;
      };
      candidate_begin_upload: {
        Args: {
          p_category: string;
          p_filename: string;
          p_link: string;
          p_mime: string;
          p_requirement: string;
          p_size: number;
        };
        Returns: Json;
      };
      candidate_finalize_upload: {
        Args: { p_document: string; p_link: string; p_sha256?: string };
        Returns: undefined;
      };
      candidate_link_case: { Args: { p_link: string }; Returns: string };
      candidate_link_secret: { Args: { p_link: string }; Returns: string };
      candidate_link_view: { Args: { p_link: string }; Returns: Json };
      candidate_open_link: { Args: { p_token_hash: string }; Returns: Json };
      candidate_post_message: { Args: { p_body: string; p_link: string }; Returns: string };
      candidate_providable: { Args: { p_category: string; p_stage: string }; Returns: boolean };
      candidate_reminder_candidates: {
        Args: Record<PropertyKey, never>;
        Returns: {
          candidate_email: string;
          candidate_name: string;
          candidate_phone: string;
          case_id: string;
          client_name: string;
          consent_missing: boolean;
          escalated_at: string;
          expires_at: string;
          language: string;
          last_reminded_at: string;
          link_id: string;
          missing_documents: number;
          open_requests: number;
          org_id: string;
          reference: string;
          reminders_sent: number;
          sent_at: string;
        }[];
      };
      candidate_submit_consent: {
        Args: {
          p_document: string;
          p_ip?: string;
          p_link: string;
          p_method: string;
          p_signed_name: string;
          p_user_agent?: string;
        };
        Returns: undefined;
      };
      case_outstanding_requirements: { Args: { p_case: string; p_stage: string }; Returns: number };
      case_transition: {
        Args: { p_case: string; p_event: string; p_reason?: string };
        Returns: Database["public"]["Enums"]["case_stage"];
      };
      case_visible: { Args: { p_case: string }; Returns: boolean };
      check_state_label: {
        Args: { p: Database["public"]["Enums"]["check_state"] };
        Returns: string;
      };
      claim_jobs: {
        Args: { p_lease_seconds?: number; p_limit?: number; p_worker: string };
        Returns: {
          attempts: number;
          claims: number;
          created_at: string;
          created_by: string | null;
          entity_id: string | null;
          entity_type: string | null;
          finished_at: string | null;
          id: string;
          idempotency_key: string | null;
          kind: string;
          last_error: string | null;
          locked_at: string | null;
          locked_by: string | null;
          locked_until: string | null;
          max_attempts: number;
          org_id: string;
          payload: NonNullable<Json>;
          priority: number;
          progress: Json | null;
          result: Json | null;
          run_after: string;
          status: Database["public"]["Enums"]["job_status"];
          updated_at: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "jobs";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      client_can_use_package: { Args: { p_client: string; p_package: string }; Returns: boolean };
      client_id_of_user: { Args: Record<PropertyKey, never>; Returns: string };
      complete_job: { Args: { p_id: string; p_result?: Json; p_worker: string }; Returns: boolean };
      create_candidate_request: { Args: { p: Json; p_case: string }; Returns: string };
      create_case: { Args: { p: Json }; Returns: Json };
      current_actor_id: { Args: Record<PropertyKey, never>; Returns: string };
      current_actor_kind: { Args: Record<PropertyKey, never>; Returns: string };
      default_org_id: { Args: Record<PropertyKey, never>; Returns: string };
      discard_check_type_draft: { Args: { p_check_type: string }; Returns: undefined };
      enqueue_job: {
        Args: {
          p_created_by?: string;
          p_entity_id?: string;
          p_entity_type?: string;
          p_idempotency_key?: string;
          p_kind: string;
          p_max_attempts?: number;
          p_org?: string;
          p_payload?: Json;
          p_priority?: number;
          p_run_after?: string;
        };
        Returns: string;
      };
      fail_job: {
        Args: { p_error: string; p_id: string; p_retryable?: boolean; p_worker: string };
        Returns: Database["public"]["Enums"]["job_status"];
      };
      finalize_document_upload: {
        Args: { p_document: string; p_sha256?: string };
        Returns: undefined;
      };
      has_permission: { Args: { p: string }; Returns: boolean };
      heartbeat_job: {
        Args: { p_id: string; p_lease_seconds?: number; p_progress?: Json; p_worker: string };
        Returns: boolean;
      };
      is_active_staff: { Args: { p_org: string; p_user: string }; Returns: boolean };
      is_client: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_staff: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_super_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      issue_candidate_link: {
        Args: {
          p_case: string;
          p_days?: number;
          p_language?: string;
          p_token_enc: string;
          p_token_hash: string;
        };
        Returns: string;
      };
      log_case_event: {
        Args: {
          p_body?: string;
          p_candidate?: boolean;
          p_case: string;
          p_check: string;
          p_client?: boolean;
          p_data?: Json;
          p_kind: string;
          p_title: string;
        };
        Returns: undefined;
      };
      log_document_access: {
        Args: { p_action: string; p_document: string; p_ip?: string };
        Returns: undefined;
      };
      log_system_event: {
        Args: {
          p_context?: Json;
          p_fingerprint?: string;
          p_kind: string;
          p_message: string;
          p_org?: string;
          p_severity?: string;
        };
        Returns: undefined;
      };
      mark_candidate_messages_read: { Args: { p_case: string }; Returns: number };
      mark_notifications_read: { Args: { p_ids?: string[] }; Returns: number };
      move_case: {
        Args: {
          p_case: string;
          p_event: string;
          p_reason?: string;
          p_returned?: boolean;
          p_to: Database["public"]["Enums"]["case_stage"];
        };
        Returns: undefined;
      };
      my_active_membership: {
        Args: Record<PropertyKey, never>;
        Returns: {
          activated_at: string | null;
          client_id: string | null;
          created_at: string;
          id: string;
          invited_at: string | null;
          invited_by: string | null;
          kind: Database["public"]["Enums"]["member_kind"];
          org_id: string;
          role_id: string;
          status: Database["public"]["Enums"]["member_status"];
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "memberships";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      my_membership: { Args: Record<PropertyKey, never>; Returns: Json };
      next_case_number: { Args: { p_org: string }; Returns: string };
      next_document_number: { Args: { p_kind: string; p_org?: string }; Returns: string };
      notify_case_owner: {
        Args: { p_body?: string; p_case: string; p_title: string; p_type: string };
        Returns: undefined;
      };
      notify_client_users: {
        Args: { p_body?: string; p_case: string; p_title: string; p_type: string };
        Returns: number;
      };
      notify_users: {
        Args: {
          p_body?: string;
          p_entity_id?: string;
          p_entity_type?: string;
          p_link?: string;
          p_org?: string;
          p_title: string;
          p_type: string;
          p_urgent?: boolean;
          p_user_ids: string[];
        };
        Returns: number;
      };
      portal_begin_upload: {
        Args: {
          p_case: string;
          p_category: string;
          p_filename: string;
          p_mime: string;
          p_requirement: string;
          p_size: number;
        };
        Returns: Json;
      };
      portal_case_detail: { Args: { p_case: string }; Returns: Json };
      portal_case_row: {
        Args: {
          c: Omit<
            Database["public"]["Tables"]["cases"]["Row"],
            Database["public"]["Tables"]["cases"]["ComputedFields"]
          >;
        };
        Returns: Json;
      };
      portal_case_visible: { Args: { p_case: string }; Returns: boolean };
      portal_cases: { Args: { p?: Json }; Returns: Json };
      portal_client: { Args: { p_permission?: string }; Returns: string };
      portal_dashboard: { Args: Record<PropertyKey, never>; Returns: Json };
      portal_finalize_upload: {
        Args: { p_document: string; p_sha256?: string };
        Returns: undefined;
      };
      portal_my_visibility: { Args: Record<PropertyKey, never>; Returns: Json };
      portal_pending_slots: { Args: { p_case: string }; Returns: number };
      portal_price_list: {
        Args: Record<PropertyKey, never>;
        Returns: {
          check_type_id: string;
          currency: string;
          description: string;
          icon: string;
          key: string;
          name: string;
          unit_price: number;
        }[];
      };
      portal_stage_label: {
        Args: { p: Database["public"]["Enums"]["case_stage"] };
        Returns: string;
      };
      portal_team: { Args: Record<PropertyKey, never>; Returns: Json };
      portal_visibility: { Args: { p_client: string }; Returns: Json };
      post_candidate_message: { Args: { p_body: string; p_case: string }; Returns: string };
      price_ai_usage: {
        Args: {
          p_at?: string;
          p_audio_seconds?: number;
          p_batch?: boolean;
          p_cache_read?: number;
          p_cache_write?: number;
          p_input: number;
          p_model: string;
          p_output: number;
        };
        Returns: number;
      };
      provision_org_roles: { Args: { p_org: string }; Returns: undefined };
      publish_check_type: { Args: { p_check_type: string; p_notes?: string }; Returns: number };
      queue_depth: { Args: Record<PropertyKey, never>; Returns: Json };
      queue_email: {
        Args: {
          p_attachments?: Json;
          p_cc?: string[];
          p_created_by?: string;
          p_entity_id?: string;
          p_entity_type?: string;
          p_html: string;
          p_org?: string;
          p_payload?: Json;
          p_reply_to?: string;
          p_subject: string;
          p_template_key?: string;
          p_text?: string;
          p_to: string[];
        };
        Returns: string;
      };
      queue_sms: {
        Args: {
          p_body: string;
          p_created_by?: string;
          p_entity_id?: string;
          p_entity_type?: string;
          p_org?: string;
          p_template_key?: string;
          p_to: string;
        };
        Returns: string;
      };
      rate_limit_check: {
        Args: { p_key: string; p_max: number; p_window_seconds: number };
        Returns: boolean;
      };
      recompute_case: { Args: { p_case: string }; Returns: undefined };
      record_candidate_link_sent: {
        Args: { p_channels: string[]; p_link: string };
        Returns: undefined;
      };
      record_candidate_reminder: {
        Args: { p_escalated?: boolean; p_link: string; p_step: number };
        Returns: undefined;
      };
      record_qc_review: {
        Args: {
          p_case: string;
          p_checklist?: Json;
          p_decision: string;
          p_kind: string;
          p_remarks?: string;
          p_return_checks?: string[];
        };
        Returns: string;
      };
      request_case_document: {
        Args: {
          p_case: string;
          p_category: string;
          p_check: string;
          p_label: string;
          p_min?: number;
          p_note?: string;
        };
        Returns: string;
      };
      request_ip: { Args: Record<PropertyKey, never>; Returns: string };
      retry_job: { Args: { p_id: string }; Returns: boolean };
      review_candidate_request: {
        Args: { p_decision: string; p_note?: string; p_request: string };
        Returns: undefined;
      };
      review_consent: {
        Args: { p_accept: boolean; p_case: string; p_document?: string; p_note?: string };
        Returns: undefined;
      };
      review_document: {
        Args: { p_accept: boolean; p_document: string; p_reason?: string };
        Returns: undefined;
      };
      revoke_candidate_link: { Args: { p_link: string; p_reason?: string }; Returns: undefined };
      save_check_type_draft: { Args: { p_check_type: string; p_schema: Json }; Returns: string };
      save_check_values: {
        Args: { p_check: string; p_valid: boolean; p_values: Json };
        Returns: undefined;
      };
      search_everything: {
        Args: { p_limit?: number; p_query: string };
        Returns: {
          href: string;
          id: string;
          kind: string;
          subtitle: string;
          title: string;
        }[];
      };
      set_case_hold: {
        Args: { p_case: string; p_hold: boolean; p_reason?: string };
        Returns: undefined;
      };
      set_check_state: {
        Args: {
          p_check: string;
          p_client_note?: string;
          p_note?: string;
          p_result?: string;
          p_state: Database["public"]["Enums"]["check_state"];
        };
        Returns: undefined;
      };
      set_document_visibility: {
        Args: { p_document: string; p_visibility: string };
        Returns: undefined;
      };
      staff_load_snapshot: { Args: { p_org?: string }; Returns: Json };
      stage_label: { Args: { p: Database["public"]["Enums"]["case_stage"] }; Returns: string };
      suggest_client_code: { Args: { p_name: string }; Returns: string };
      sweep_jobs: { Args: Record<PropertyKey, never>; Returns: Json };
      sync_requirement_counts: { Args: { p_case: string }; Returns: undefined };
      update_candidate: { Args: { p: Json; p_candidate: string }; Returns: undefined };
      update_case_details: { Args: { p: Json; p_case: string }; Returns: undefined };
      waive_requirement: { Args: { p_reason: string; p_requirement: string }; Returns: undefined };
    };
    Enums: {
      case_stage:
        | "intake"
        | "documents"
        | "pre_qc"
        | "data_entry"
        | "verification"
        | "post_qc"
        | "report"
        | "approval"
        | "released"
        | "cancelled";
      check_state:
        | "not_started"
        | "in_progress"
        | "awaiting_response"
        | "pending_info"
        | "returned"
        | "completed"
        | "discrepancy"
        | "unable_to_verify"
        | "waived";
      job_status: "queued" | "running" | "succeeded" | "failed" | "dead" | "cancelled";
      member_kind: "staff" | "client";
      member_status: "invited" | "active" | "suspended";
      process_type: "client_supplied" | "candidate_collected";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      case_stage: [
        "intake",
        "documents",
        "pre_qc",
        "data_entry",
        "verification",
        "post_qc",
        "report",
        "approval",
        "released",
        "cancelled",
      ],
      check_state: [
        "not_started",
        "in_progress",
        "awaiting_response",
        "pending_info",
        "returned",
        "completed",
        "discrepancy",
        "unable_to_verify",
        "waived",
      ],
      job_status: ["queued", "running", "succeeded", "failed", "dead", "cancelled"],
      member_kind: ["staff", "client"],
      member_status: ["invited", "active", "suspended"],
      process_type: ["client_supplied", "candidate_collected"],
    },
  },
} as const;
