export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      api_keys: {
        Row: {
          ciphertext: string;
          created_at: string;
          iv: string;
          last4: string;
          provider: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          ciphertext: string;
          created_at?: string;
          iv: string;
          last4: string;
          provider: string;
          user_id: string;
        };
        Update: {
          ciphertext?: string;
          created_at?: string;
          iv?: string;
          last4?: string;
          provider?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      app_admins: {
        Row: {
          created_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      companies: {
        Row: {
          careers_url: string | null;
          created_at: string;
          id: string;
          name: string;
          normalized_name: string;
          website: string | null;
        };
        ComputedFields: never;
        Insert: {
          careers_url?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          normalized_name: string;
          website?: string | null;
        };
        Update: {
          careers_url?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          normalized_name?: string;
          website?: string | null;
        };
        Relationships: [];
      };
      fact_bank: {
        Row: {
          content: NonNullable<Json>;
          created_at: string;
          id: string;
          kind: string;
          source: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          content: NonNullable<Json>;
          created_at?: string;
          id?: string;
          kind: string;
          source?: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          content?: NonNullable<Json>;
          created_at?: string;
          id?: string;
          kind?: string;
          source?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      follows: {
        Row: {
          board_kind: string | null;
          board_ref: string | null;
          company_id: string;
          created_at: string;
          priority: boolean;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          board_kind?: string | null;
          board_ref?: string | null;
          company_id: string;
          created_at?: string;
          priority?: boolean;
          user_id?: string;
        };
        Update: {
          board_kind?: string | null;
          board_ref?: string | null;
          company_id?: string;
          created_at?: string;
          priority?: boolean;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "follows_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      invites: {
        Row: {
          code: string;
          created_at: string;
          created_by: string | null;
          id: string;
          note: string | null;
          revoked_at: string | null;
          used_at: string | null;
          used_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          code?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          note?: string | null;
          revoked_at?: string | null;
          used_at?: string | null;
          used_by?: string | null;
        };
        Update: {
          code?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          note?: string | null;
          revoked_at?: string | null;
          used_at?: string | null;
          used_by?: string | null;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          channel: string;
          id: string;
          payload: NonNullable<Json>;
          run_id: string;
          sent_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          channel: string;
          id?: string;
          payload: NonNullable<Json>;
          run_id: string;
          sent_at?: string;
          user_id: string;
        };
        Update: {
          channel?: string;
          id?: string;
          payload?: NonNullable<Json>;
          run_id?: string;
          sent_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "runs";
            referencedColumns: ["id"];
          },
        ];
      };
      posting_sources: {
        Row: {
          active: boolean;
          content_hash: string;
          data: NonNullable<Json>;
          first_seen_at: string;
          id: string;
          last_seen_at: string;
          missed_runs: number;
          posting_id: string;
          raw: NonNullable<Json>;
          source_id: string;
          source_job_id: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          content_hash: string;
          data: NonNullable<Json>;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          missed_runs?: number;
          posting_id: string;
          raw: NonNullable<Json>;
          source_id: string;
          source_job_id: string;
        };
        Update: {
          active?: boolean;
          content_hash?: string;
          data?: NonNullable<Json>;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          missed_runs?: number;
          posting_id?: string;
          raw?: NonNullable<Json>;
          source_id?: string;
          source_job_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "posting_sources_posting_id_fkey";
            columns: ["posting_id"];
            isOneToOne: false;
            referencedRelation: "postings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "posting_sources_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "sources";
            referencedColumns: ["id"];
          },
        ];
      };
      postings: {
        Row: {
          ats: string | null;
          ats_job_id: string | null;
          canonical_url: string;
          category: string | null;
          closed_at: string | null;
          company_id: string;
          content_hash: string;
          degrees: string[];
          description: string | null;
          first_seen_at: string;
          fuzzy_key: string | null;
          id: string;
          last_seen_at: string;
          locations: string[];
          posted_at: string | null;
          questions: Json | null;
          questions_fetched_at: string | null;
          questions_status: string | null;
          source_names: string[];
          sponsorship: string;
          status: string;
          terms: string[];
          title: string;
          updated_at: string;
          url: string;
        };
        ComputedFields: never;
        Insert: {
          ats?: string | null;
          ats_job_id?: string | null;
          canonical_url: string;
          category?: string | null;
          closed_at?: string | null;
          company_id: string;
          content_hash: string;
          degrees?: string[];
          description?: string | null;
          first_seen_at?: string;
          fuzzy_key?: string | null;
          id?: string;
          last_seen_at?: string;
          locations?: string[];
          posted_at?: string | null;
          questions?: Json | null;
          questions_fetched_at?: string | null;
          questions_status?: string | null;
          source_names?: string[];
          sponsorship?: string;
          status?: string;
          terms?: string[];
          title: string;
          updated_at?: string;
          url: string;
        };
        Update: {
          ats?: string | null;
          ats_job_id?: string | null;
          canonical_url?: string;
          category?: string | null;
          closed_at?: string | null;
          company_id?: string;
          content_hash?: string;
          degrees?: string[];
          description?: string | null;
          first_seen_at?: string;
          fuzzy_key?: string | null;
          id?: string;
          last_seen_at?: string;
          locations?: string[];
          posted_at?: string | null;
          questions?: Json | null;
          questions_fetched_at?: string | null;
          questions_status?: string | null;
          source_names?: string[];
          sponsorship?: string;
          status?: string;
          terms?: string[];
          title?: string;
          updated_at?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "postings_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          ai_provider: string | null;
          auto_tailor: boolean;
          created_at: string;
          daily_cap: number;
          degree: string | null;
          email: string | null;
          grad_month: number | null;
          grad_year: number | null;
          invited_at: string | null;
          links: NonNullable<Json>;
          major: string | null;
          mode: string;
          name: string | null;
          needs_sponsorship: boolean | null;
          notify_prefs: NonNullable<Json>;
          onboarding_step: number;
          phone: string | null;
          school: string | null;
          standard_answers: NonNullable<Json>;
          updated_at: string;
          user_id: string;
          work_authorized: boolean | null;
        };
        ComputedFields: never;
        Insert: {
          ai_provider?: string | null;
          auto_tailor?: boolean;
          created_at?: string;
          daily_cap?: number;
          degree?: string | null;
          email?: string | null;
          grad_month?: number | null;
          grad_year?: number | null;
          invited_at?: string | null;
          links?: NonNullable<Json>;
          major?: string | null;
          mode?: string;
          name?: string | null;
          needs_sponsorship?: boolean | null;
          notify_prefs?: NonNullable<Json>;
          onboarding_step?: number;
          phone?: string | null;
          school?: string | null;
          standard_answers?: NonNullable<Json>;
          updated_at?: string;
          user_id: string;
          work_authorized?: boolean | null;
        };
        Update: {
          ai_provider?: string | null;
          auto_tailor?: boolean;
          created_at?: string;
          daily_cap?: number;
          degree?: string | null;
          email?: string | null;
          grad_month?: number | null;
          grad_year?: number | null;
          invited_at?: string | null;
          links?: NonNullable<Json>;
          major?: string | null;
          mode?: string;
          name?: string | null;
          needs_sponsorship?: boolean | null;
          notify_prefs?: NonNullable<Json>;
          onboarding_step?: number;
          phone?: string | null;
          school?: string | null;
          standard_answers?: NonNullable<Json>;
          updated_at?: string;
          user_id?: string;
          work_authorized?: boolean | null;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          created_at: string;
          endpoint: string;
          id: string;
          keys: NonNullable<Json>;
          user_agent: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          endpoint: string;
          id?: string;
          keys: NonNullable<Json>;
          user_agent?: string | null;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          endpoint?: string;
          id?: string;
          keys?: NonNullable<Json>;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      resumes: {
        Row: {
          content: Json | null;
          created_at: string;
          file_name: string | null;
          file_path: string | null;
          import_notes: Json | null;
          kind: string;
          text_content: string | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          content?: Json | null;
          created_at?: string;
          file_name?: string | null;
          file_path?: string | null;
          import_notes?: Json | null;
          kind?: string;
          text_content?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          content?: Json | null;
          created_at?: string;
          file_name?: string | null;
          file_path?: string | null;
          import_notes?: Json | null;
          kind?: string;
          text_content?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      runs: {
        Row: {
          errors: NonNullable<Json>;
          finished_at: string | null;
          github_run_id: string | null;
          id: string;
          is_seed: boolean;
          ok: boolean | null;
          started_at: string;
          stats: NonNullable<Json>;
          trigger: string | null;
        };
        ComputedFields: never;
        Insert: {
          errors?: NonNullable<Json>;
          finished_at?: string | null;
          github_run_id?: string | null;
          id?: string;
          is_seed?: boolean;
          ok?: boolean | null;
          started_at?: string;
          stats?: NonNullable<Json>;
          trigger?: string | null;
        };
        Update: {
          errors?: NonNullable<Json>;
          finished_at?: string | null;
          github_run_id?: string | null;
          id?: string;
          is_seed?: boolean;
          ok?: boolean | null;
          started_at?: string;
          stats?: NonNullable<Json>;
          trigger?: string | null;
        };
        Relationships: [];
      };
      sources: {
        Row: {
          company_id: string | null;
          config: NonNullable<Json>;
          created_at: string;
          enabled: boolean;
          id: string;
          key: string;
          kind: string;
          last_alert: string | null;
          last_checked_at: string | null;
          last_count: number | null;
          last_error: string | null;
          last_sha_or_etag: string | null;
          last_success_at: string | null;
          name: string;
          shard: number | null;
          tier: string;
        };
        ComputedFields: never;
        Insert: {
          company_id?: string | null;
          config?: NonNullable<Json>;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          key: string;
          kind: string;
          last_alert?: string | null;
          last_checked_at?: string | null;
          last_count?: number | null;
          last_error?: string | null;
          last_sha_or_etag?: string | null;
          last_success_at?: string | null;
          name: string;
          shard?: number | null;
          tier?: string;
        };
        Update: {
          company_id?: string | null;
          config?: NonNullable<Json>;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          key?: string;
          kind?: string;
          last_alert?: string | null;
          last_checked_at?: string | null;
          last_count?: number | null;
          last_error?: string | null;
          last_sha_or_etag?: string | null;
          last_success_at?: string | null;
          name?: string;
          shard?: number | null;
          tier?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sources_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      status_events: {
        Row: {
          at: string;
          from_status: string | null;
          id: string;
          to_status: string;
          user_posting_id: string;
        };
        ComputedFields: never;
        Insert: {
          at?: string;
          from_status?: string | null;
          id?: string;
          to_status: string;
          user_posting_id: string;
        };
        Update: {
          at?: string;
          from_status?: string | null;
          id?: string;
          to_status?: string;
          user_posting_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "status_events_user_posting_id_fkey";
            columns: ["user_posting_id"];
            isOneToOne: false;
            referencedRelation: "user_postings";
            referencedColumns: ["id"];
          },
        ];
      };
      user_postings: {
        Row: {
          answer_sheet: Json | null;
          applied_at: string | null;
          created_at: string;
          id: string;
          manual: Json | null;
          notes: string | null;
          posting_id: string | null;
          referral: boolean;
          referrer: string | null;
          resume_note: string | null;
          seen_at: string | null;
          skip_reason: string | null;
          status: string;
          status_unsure: boolean;
          term: string | null;
          updated_at: string;
          user_id: string;
          watch_profile_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          answer_sheet?: Json | null;
          applied_at?: string | null;
          created_at?: string;
          id?: string;
          manual?: Json | null;
          notes?: string | null;
          posting_id?: string | null;
          referral?: boolean;
          referrer?: string | null;
          resume_note?: string | null;
          seen_at?: string | null;
          skip_reason?: string | null;
          status?: string;
          status_unsure?: boolean;
          term?: string | null;
          updated_at?: string;
          user_id?: string;
          watch_profile_id?: string | null;
        };
        Update: {
          answer_sheet?: Json | null;
          applied_at?: string | null;
          created_at?: string;
          id?: string;
          manual?: Json | null;
          notes?: string | null;
          posting_id?: string | null;
          referral?: boolean;
          referrer?: string | null;
          resume_note?: string | null;
          seen_at?: string | null;
          skip_reason?: string | null;
          status?: string;
          status_unsure?: boolean;
          term?: string | null;
          updated_at?: string;
          user_id?: string;
          watch_profile_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "user_postings_posting_id_fkey";
            columns: ["posting_id"];
            isOneToOne: false;
            referencedRelation: "postings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_postings_watch_profile_id_fkey";
            columns: ["watch_profile_id"];
            isOneToOne: false;
            referencedRelation: "watch_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      watch_profiles: {
        Row: {
          active: boolean;
          categories: string[];
          created_at: string;
          exclude_keywords: string[];
          id: string;
          include_keywords: string[];
          locations: string[];
          name: string;
          needs_sponsorship: boolean;
          preset: string;
          remote_ok: boolean;
          terms: string[];
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          categories?: string[];
          created_at?: string;
          exclude_keywords?: string[];
          id?: string;
          include_keywords?: string[];
          locations?: string[];
          name: string;
          needs_sponsorship?: boolean;
          preset: string;
          remote_ok?: boolean;
          terms?: string[];
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          active?: boolean;
          categories?: string[];
          created_at?: string;
          exclude_keywords?: string[];
          id?: string;
          include_keywords?: string[];
          locations?: string[];
          name?: string;
          needs_sponsorship?: boolean;
          preset?: string;
          remote_ok?: boolean;
          terms?: string[];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      api_keys_public: {
        Row: {
          created_at: string | null;
          last4: string | null;
          provider: string | null;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string | null;
          last4?: string | null;
          provider?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          last4?: string | null;
          provider?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      api_key_server_ok: { Args: { p_secret: string }; Returns: boolean };
      dispatch_watch: { Args: Record<PropertyKey, never>; Returns: number };
      follow_board: {
        Args: {
          p_company_name: string;
          p_config: Json;
          p_kind: string;
          p_normalized_name: string;
        };
        Returns: Json;
      };
      follow_company: { Args: { p_company_id: string }; Returns: Json };
      follow_precheck: { Args: { p_company_id: string }; Returns: string };
      generate_invite_code: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      max_follows: { Args: Record<PropertyKey, never>; Returns: number };
      posting_boards: { Args: { p_posting_id: string }; Returns: Json };
      redeem_invite: { Args: { p_code: string }; Returns: string };
      save_api_key: {
        Args: {
          p_ciphertext: string;
          p_iv: string;
          p_last4: string;
          p_provider: string;
          p_secret: string;
        };
        Returns: undefined;
      };
      save_posting_questions: {
        Args: { p_posting_id: string; p_questions: Json; p_status: string };
        Returns: string;
      };
      save_push_subscription: {
        Args: { p_endpoint: string; p_keys: Json; p_user_agent: string };
        Returns: string;
      };
      sealed_api_key: {
        Args: { p_secret: string };
        Returns: {
          ciphertext: string;
          iv: string;
          provider: string;
        }[];
      };
      touch_seen: { Args: { p_link_ids: string[] }; Returns: undefined };
      update_links: { Args: { p_links: Json }; Returns: undefined };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

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
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
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
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
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
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
