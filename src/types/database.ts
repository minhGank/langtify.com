export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      in_app_notifications: {
        Row: {
          id: string;
          user_id: string;
          kind: string;
          source_key: string;
          actor_user_id: string | null;
          submission_id: string | null;
          challenge_id: string | null;
          created_at: string;
          read_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          kind: string;
          source_key: string;
          actor_user_id?: string | null;
          submission_id?: string | null;
          challenge_id?: string | null;
          created_at?: string;
          read_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          kind?: string;
          source_key?: string;
          actor_user_id?: string | null;
          submission_id?: string | null;
          challenge_id?: string | null;
          created_at?: string;
          read_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'in_app_notifications_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'in_app_notifications_submission_id_fkey';
            columns: ['submission_id'];
            isOneToOne: false;
            referencedRelation: 'submissions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'in_app_notifications_challenge_id_fkey';
            columns: ['challenge_id'];
            isOneToOne: false;
            referencedRelation: 'daily_challenges';
            referencedColumns: ['id'];
          },
        ];
      };
      daily_challenge_words: {
        Row: {
          assigned_at: string;
          cefr_level: string;
          concept_id: string;
          daily_challenge_id: string;
          id: string;
          reference_language_id: string;
          reference_term: string;
          reference_term_id: string;
          replaced_at: string | null;
          slot: string;
          target_language_id: string;
          target_term: string;
          vocabulary_term_id: string;
        };
        Insert: {
          assigned_at?: string;
          cefr_level: string;
          concept_id: string;
          daily_challenge_id: string;
          id?: string;
          reference_language_id: string;
          reference_term: string;
          reference_term_id: string;
          replaced_at?: string | null;
          slot: string;
          target_language_id: string;
          target_term: string;
          vocabulary_term_id: string;
        };
        Update: {
          assigned_at?: string;
          cefr_level?: string;
          concept_id?: string;
          daily_challenge_id?: string;
          id?: string;
          reference_language_id?: string;
          reference_term?: string;
          reference_term_id?: string;
          replaced_at?: string | null;
          slot?: string;
          target_language_id?: string;
          target_term?: string;
          vocabulary_term_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'assignment_challenge_languages_fk';
            columns: ['daily_challenge_id', 'target_language_id', 'reference_language_id'];
            isOneToOne: false;
            referencedRelation: 'daily_challenges';
            referencedColumns: ['id', 'target_language_id', 'reference_language_id'];
          },
          {
            foreignKeyName: 'assignment_reference_identity_fk';
            columns: ['reference_term_id', 'concept_id', 'reference_language_id'];
            isOneToOne: false;
            referencedRelation: 'vocabulary_terms';
            referencedColumns: ['id', 'concept_id', 'language_id'];
          },
          {
            foreignKeyName: 'assignment_target_identity_fk';
            columns: ['vocabulary_term_id', 'concept_id', 'target_language_id'];
            isOneToOne: false;
            referencedRelation: 'vocabulary_terms';
            referencedColumns: ['id', 'concept_id', 'language_id'];
          },
          {
            foreignKeyName: 'daily_challenge_words_concept_id_fkey';
            columns: ['concept_id'];
            isOneToOne: false;
            referencedRelation: 'vocabulary_concepts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'daily_challenge_words_daily_challenge_id_fkey';
            columns: ['daily_challenge_id'];
            isOneToOne: false;
            referencedRelation: 'daily_challenges';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'daily_challenge_words_reference_term_id_fkey';
            columns: ['reference_term_id'];
            isOneToOne: false;
            referencedRelation: 'vocabulary_terms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'daily_challenge_words_vocabulary_term_id_fkey';
            columns: ['vocabulary_term_id'];
            isOneToOne: false;
            referencedRelation: 'vocabulary_terms';
            referencedColumns: ['id'];
          },
        ];
      };
      daily_challenges: {
        Row: {
          cefr_level: string;
          created_at: string;
          id: string;
          local_challenge_date: string;
          reference_language_id: string;
          target_language_id: string;
          timezone: string;
          user_id: string;
          user_language_profile_id: string;
        };
        Insert: {
          cefr_level: string;
          created_at?: string;
          id?: string;
          local_challenge_date: string;
          reference_language_id: string;
          target_language_id: string;
          timezone: string;
          user_id: string;
          user_language_profile_id: string;
        };
        Update: {
          cefr_level?: string;
          created_at?: string;
          id?: string;
          local_challenge_date?: string;
          reference_language_id?: string;
          target_language_id?: string;
          timezone?: string;
          user_id?: string;
          user_language_profile_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'daily_challenges_reference_language_id_fkey';
            columns: ['reference_language_id'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'daily_challenges_target_language_id_fkey';
            columns: ['target_language_id'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'daily_challenges_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'daily_challenges_user_language_profile_id_fkey';
            columns: ['user_language_profile_id'];
            isOneToOne: false;
            referencedRelation: 'user_language_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      languages: {
        Row: {
          code: string;
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          native_name: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          native_name: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          native_name?: string;
        };
        Relationships: [];
      };
      moderation_audit: {
        Row: {
          action: string;
          created_at: string;
          id: number;
          moderator_user_id: string;
          reason: string;
          report_id: string;
          request_id: string;
          target_id: string;
          target_kind: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          id?: never;
          moderator_user_id: string;
          reason?: string;
          report_id: string;
          request_id: string;
          target_id: string;
          target_kind: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          id?: never;
          moderator_user_id?: string;
          reason?: string;
          report_id?: string;
          request_id?: string;
          target_id?: string;
          target_kind?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'moderation_audit_report_id_fkey';
            columns: ['report_id'];
            isOneToOne: false;
            referencedRelation: 'safety_reports';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_preferences: {
        Row: {
          daily_time: string;
          daily_words: boolean;
          enabled: boolean;
          next_check_at: string;
          streak_reminder: boolean;
          streak_time: string;
          user_id: string;
        };
        Insert: {
          daily_time?: string;
          daily_words?: boolean;
          enabled?: boolean;
          next_check_at?: string;
          streak_reminder?: boolean;
          streak_time?: string;
          user_id: string;
        };
        Update: {
          daily_time?: string;
          daily_words?: boolean;
          enabled?: boolean;
          next_check_at?: string;
          streak_reminder?: boolean;
          streak_time?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          id: string;
          onboarding_completed_at: string | null;
          public_id: string;
          updated_at: string;
          username: string | null;
        };
        Insert: {
          created_at?: string;
          id: string;
          onboarding_completed_at?: string | null;
          public_id?: string;
          updated_at?: string;
          username?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          onboarding_completed_at?: string | null;
          public_id?: string;
          updated_at?: string;
          username?: string | null;
        };
        Relationships: [];
      };
      safety_reports: {
        Row: {
          comment_snapshot: string;
          context_submission_id: string;
          created_at: string;
          details: string;
          id: string;
          reason: string;
          reporter_user_id: string;
          status: string;
          subject_user_id: string;
          target_id: string;
          target_kind: string;
          username_snapshot: string;
          word_snapshot: string;
        };
        Insert: {
          comment_snapshot?: string;
          context_submission_id: string;
          created_at?: string;
          details?: string;
          id?: string;
          reason: string;
          reporter_user_id: string;
          status?: string;
          subject_user_id: string;
          target_id: string;
          target_kind: string;
          username_snapshot: string;
          word_snapshot: string;
        };
        Update: {
          comment_snapshot?: string;
          context_submission_id?: string;
          created_at?: string;
          details?: string;
          id?: string;
          reason?: string;
          reporter_user_id?: string;
          status?: string;
          subject_user_id?: string;
          target_id?: string;
          target_kind?: string;
          username_snapshot?: string;
          word_snapshot?: string;
        };
        Relationships: [];
      };
      submission_comments: {
        Row: {
          author_user_id: string;
          body: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          removed: boolean;
          request_id: string;
          submission_id: string;
        };
        Insert: {
          author_user_id: string;
          body: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          removed?: boolean;
          request_id: string;
          submission_id: string;
        };
        Update: {
          author_user_id?: string;
          body?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          removed?: boolean;
          request_id?: string;
          submission_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'submission_comments_submission_id_fkey';
            columns: ['submission_id'];
            isOneToOne: false;
            referencedRelation: 'submissions';
            referencedColumns: ['id'];
          },
        ];
      };
      submission_ratings: {
        Row: {
          created_at: string;
          rater_user_id: string;
          score: number;
          submission_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          rater_user_id: string;
          score: number;
          submission_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          rater_user_id?: string;
          score?: number;
          submission_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'submission_ratings_submission_id_fkey';
            columns: ['submission_id'];
            isOneToOne: false;
            referencedRelation: 'submissions';
            referencedColumns: ['id'];
          },
        ];
      };
      submissions: {
        Row: {
          capture_kind: string;
          concept_id: string;
          created_at: string;
          daily_challenge_id: string;
          daily_challenge_word_id: string;
          deleted_at: string | null;
          expires_at: string;
          id: string;
          reference_term: string;
          reference_term_id: string;
          status: string;
          storage_path: string;
          submitted_at: string | null;
          target_term: string;
          updated_at: string;
          user_id: string;
          visibility: string;
          vocabulary_term_id: string;
        };
        Insert: {
          capture_kind?: string;
          concept_id: string;
          created_at?: string;
          daily_challenge_id: string;
          daily_challenge_word_id: string;
          deleted_at?: string | null;
          expires_at?: string;
          id?: string;
          reference_term: string;
          reference_term_id: string;
          status?: string;
          storage_path: string;
          submitted_at?: string | null;
          target_term: string;
          updated_at?: string;
          user_id: string;
          visibility?: string;
          vocabulary_term_id: string;
        };
        Update: {
          capture_kind?: string;
          concept_id?: string;
          created_at?: string;
          daily_challenge_id?: string;
          daily_challenge_word_id?: string;
          deleted_at?: string | null;
          expires_at?: string;
          id?: string;
          reference_term?: string;
          reference_term_id?: string;
          status?: string;
          storage_path?: string;
          submitted_at?: string | null;
          target_term?: string;
          updated_at?: string;
          user_id?: string;
          visibility?: string;
          vocabulary_term_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'submissions_daily_challenge_id_user_id_fkey';
            columns: ['daily_challenge_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'daily_challenges';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'submissions_daily_challenge_word_id_daily_challenge_id_con_fkey';
            columns: [
              'daily_challenge_word_id',
              'daily_challenge_id',
              'concept_id',
              'vocabulary_term_id',
              'reference_term_id',
            ];
            isOneToOne: false;
            referencedRelation: 'daily_challenge_words';
            referencedColumns: [
              'id',
              'daily_challenge_id',
              'concept_id',
              'vocabulary_term_id',
              'reference_term_id',
            ];
          },
          {
            foreignKeyName: 'submissions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      user_blocks: {
        Row: {
          blocked_user_id: string;
          blocker_user_id: string;
          created_at: string;
          id: string;
        };
        Insert: {
          blocked_user_id: string;
          blocker_user_id: string;
          created_at?: string;
          id?: string;
        };
        Update: {
          blocked_user_id?: string;
          blocker_user_id?: string;
          created_at?: string;
          id?: string;
        };
        Relationships: [];
      };
      user_follows: {
        Row: {
          created_at: string;
          followed_user_id: string;
          follower_user_id: string;
        };
        Insert: {
          created_at?: string;
          followed_user_id: string;
          follower_user_id: string;
        };
        Update: {
          created_at?: string;
          followed_user_id?: string;
          follower_user_id?: string;
        };
        Relationships: [];
      };
      user_language_profiles: {
        Row: {
          cefr_level: string;
          created_at: string;
          id: string;
          reference_language_id: string;
          target_language_id: string;
          timezone: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          cefr_level: string;
          created_at?: string;
          id?: string;
          reference_language_id: string;
          target_language_id: string;
          timezone: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          cefr_level?: string;
          created_at?: string;
          id?: string;
          reference_language_id?: string;
          target_language_id?: string;
          timezone?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_language_profiles_reference_language_id_fkey';
            columns: ['reference_language_id'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_language_profiles_target_language_id_fkey';
            columns: ['target_language_id'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_language_profiles_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      vocabulary_concepts: {
        Row: {
          category: string;
          concept_key: string;
          created_at: string;
          id: string;
          is_active: boolean;
          is_photographable: boolean;
          updated_at: string;
        };
        Insert: {
          category: string;
          concept_key: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_photographable?: boolean;
          updated_at?: string;
        };
        Update: {
          category?: string;
          concept_key?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_photographable?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      vocabulary_terms: {
        Row: {
          cefr_level: string;
          concept_id: string;
          created_at: string;
          id: string;
          is_active: boolean;
          language_id: string;
          part_of_speech: string;
          term: string;
          updated_at: string;
        };
        Insert: {
          cefr_level: string;
          concept_id: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          language_id: string;
          part_of_speech: string;
          term: string;
          updated_at?: string;
        };
        Update: {
          cefr_level?: string;
          concept_id?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          language_id?: string;
          part_of_speech?: string;
          term?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'vocabulary_terms_concept_id_fkey';
            columns: ['concept_id'];
            isOneToOne: false;
            referencedRelation: 'vocabulary_concepts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'vocabulary_terms_language_id_fkey';
            columns: ['language_id'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['id'];
          },
        ];
      };
      xp_events: {
        Row: {
          amount: number;
          cause_submission_id: string;
          created_at: string;
          event_type: string;
          id: string;
          source_key: string;
          source_revision: number;
          user_id: string;
        };
        Insert: {
          amount: number;
          cause_submission_id: string;
          created_at?: string;
          event_type: string;
          id?: string;
          source_key: string;
          source_revision: number;
          user_id: string;
        };
        Update: {
          amount?: number;
          cause_submission_id?: string;
          created_at?: string;
          event_type?: string;
          id?: string;
          source_key?: string;
          source_revision?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'xp_events_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      activate_profile_avatar: {
        Args: {
          avatar_id: string;
          expected_object_id: string;
          expected_object_version: string;
          expected_user_id: string;
          image_height: number;
          image_sha256: string;
          image_width: number;
        };
        Returns: Json;
      };
      attest_submission_photo: {
        Args: {
          expected_object_id: string;
          expected_object_version: string;
          expected_user_id: string;
          image_height: number;
          image_sha256: string;
          image_width: number;
          submission_id: string;
        };
        Returns: undefined;
      };
      authorize_notification_attempt: {
        Args: { notification_id: string };
        Returns: boolean;
      };
      avatar_verification_target: {
        Args: { avatar_id: string; expected_user_id: string };
        Returns: Json;
      };
      begin_submission_deletion: {
        Args: { submission_id: string };
        Returns: {
          concept_id: string;
          created_at: string;
          daily_challenge_id: string;
          daily_challenge_word_id: string;
          deleted_at: string | null;
          expires_at: string;
          id: string;
          reference_term: string;
          reference_term_id: string;
          status: string;
          storage_path: string;
          submitted_at: string | null;
          target_term: string;
          updated_at: string;
          user_id: string;
          visibility: string;
          vocabulary_term_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'submissions';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      block_public_profile: { Args: { profile_id: string }; Returns: Json };
      block_submission_user: { Args: { submission_id: string }; Returns: Json };
      can_upload_avatar_object: {
        Args: { object_name: string };
        Returns: boolean;
      };
      can_upload_submission_object: {
        Args: { object_path: string };
        Returns: boolean;
      };
      claim_avatar_cleanup: {
        Args: { batch_size?: number };
        Returns: {
          storage_path: string;
        }[];
      };
      claim_notification_attempts: {
        Args: { batch_size?: number };
        Returns: Json;
      };
      claim_notification_receipts: {
        Args: { batch_size?: number };
        Returns: Json;
      };
      claim_photo_cleanup: {
        Args: { batch_size?: number };
        Returns: {
          storage_path: string;
        }[];
      };
      complete_onboarding: {
        Args: {
          p_cefr_level: string;
          p_reference_language_id: string;
          p_target_language_id: string;
          p_timezone: string;
          p_username: string;
        };
        Returns: undefined;
      };
      create_submission_comment: {
        Args: { body: string; request_id: string; submission_id: string };
        Returns: Json;
      };
      delete_submission_comment: { Args: { comment_id: string }; Returns: Json };
      finalize_submission: {
        Args: { requested_visibility?: string; submission_id: string };
        Returns: {
          concept_id: string;
          created_at: string;
          daily_challenge_id: string;
          daily_challenge_word_id: string;
          deleted_at: string | null;
          expires_at: string;
          id: string;
          reference_term: string;
          reference_term_id: string;
          status: string;
          storage_path: string;
          submitted_at: string | null;
          target_term: string;
          updated_at: string;
          user_id: string;
          visibility: string;
          vocabulary_term_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'submissions';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      finish_avatar_cleanup: {
        Args: { object_path: string };
        Returns: undefined;
      };
      finish_photo_cleanup: {
        Args: { object_path: string };
        Returns: undefined;
      };
      finish_submission_deletion: {
        Args: { submission_id: string };
        Returns: {
          concept_id: string;
          created_at: string;
          daily_challenge_id: string;
          daily_challenge_word_id: string;
          deleted_at: string | null;
          expires_at: string;
          id: string;
          reference_term: string;
          reference_term_id: string;
          status: string;
          storage_path: string;
          submitted_at: string | null;
          target_term: string;
          updated_at: string;
          user_id: string;
          visibility: string;
          vocabulary_term_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'submissions';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      get_assignment_photo: { Args: { assignment_id: string }; Returns: Json };
      get_my_past_words: {
        Args: {
          search_text?: string;
          requested_level?: string;
          before_captured?: boolean;
          before_date?: string;
          before_id?: string;
          page_size?: number;
        };
        Returns: Json;
      };
      reserve_historical_submission: {
        Args: { assignment_id: string };
        Returns: Database['public']['Tables']['submissions']['Row'];
      };
      get_avatar_targets: {
        Args: { avatar_ids: string[]; viewer: string };
        Returns: {
          id: string;
          storage_path: string;
        }[];
      };
      get_blocked_users: { Args: { before_id?: string }; Returns: Json };
      search_vocabulary_terms: {
        Args: { query: string; before_term?: string; before_id?: string; page_size?: number };
        Returns: Json;
      };
      get_explore_concept: { Args: { concept_id: string }; Returns: Json };
      get_concept_submissions: {
        Args: { concept_id: string; before_time?: string; before_id?: string; page_size?: number };
        Returns: Json;
      };
      get_discover_submission: { Args: { submission_id: string }; Returns: Json };
      get_discover_feed: {
        Args: { before_id?: string; before_time?: string; page_size?: number };
        Returns: Json;
      };
      get_public_profile_submissions: {
        Args: { profile_id: string; before_id?: string; before_time?: string; page_size?: number };
        Returns: Json;
      };
      get_discover_photo_targets: {
        Args: {
          expected_target: string;
          submission_ids: string[];
          viewer: string;
        };
        Returns: {
          average_rating: number;
          can_rate: boolean;
          cefr_level: string;
          id: string;
          rating_count: number;
          reference_term: string;
          storage_path: string;
          submitted_at: string;
          target_term: string;
          username: string;
          viewer_rating: number;
        }[];
      };
      get_moderation_history: {
        Args: { before_id?: number; report_id: string };
        Returns: Json;
      };
      get_moderation_photo_target: {
        Args: { report_id: string; viewer: string };
        Returns: {
          id: string;
          storage_path: string;
        }[];
      };
      get_moderation_queue: {
        Args: { after_id?: string; after_time?: string; report_status?: string };
        Returns: Json;
      };
      get_moderation_report: { Args: { report_id: string }; Returns: Json };
      get_my_progress: { Args: { challenge_id?: string }; Returns: Json };
      get_my_vocabulary: {
        Args: {
          before_id?: string;
          before_time?: string;
          page_size?: number;
          requested_concept?: string;
          requested_level?: string;
          search_text?: string;
        };
        Returns: Json;
      };
      get_profile_connections: {
        Args: {
          profile_id: string;
          list_kind: string;
          before_time?: string;
          before_id?: string;
          page_size?: number;
        };
        Returns: Json;
      };
      get_notification_inbox: {
        Args: { before_time?: string; before_id?: string; page_size?: number };
        Returns: Json;
      };
      get_notification_summary: { Args: never; Returns: Json };
      set_notification_read: {
        Args: { notification_id: string; read: boolean };
        Returns: Json;
      };
      mark_notifications_read: {
        Args: { through_time: string; through_id: string };
        Returns: Json;
      };
      resolve_notification_target: { Args: { notification_id: string }; Returns: Json };
      get_notification_preferences: { Args: never; Returns: Json };
      get_or_create_today_challenge: { Args: never; Returns: Json };
      get_own_avatar: { Args: never; Returns: Json };
      get_public_profile: {
        Args: { profile_id?: string; submission_id?: string };
        Returns: Json;
      };
      get_safety_access: { Args: never; Returns: Json };
      get_submission_comments: {
        Args: {
          before_id?: string;
          before_time?: string;
          submission_id: string;
        };
        Returns: Json;
      };
      get_submission_xp: { Args: { submission_id: string }; Returns: Json };
      moderate_report: {
        Args: {
          action: string;
          reason?: string;
          report_id: string;
          request_id: string;
        };
        Returns: Json;
      };
      photo_verification_target: {
        Args: { expected_user_id: string; submission_id: string };
        Returns: Json;
      };
      prepare_due_notifications: {
        Args: { batch_size?: number };
        Returns: Json;
      };
      rate_submission: {
        Args: { score: number; submission_id: string };
        Returns: Json;
      };
      record_notification_receipt: {
        Args: {
          notification_id: string;
          provider_error?: string;
          provider_ticket: string;
          receipt_status: string;
        };
        Returns: undefined;
      };
      record_notification_result: {
        Args: {
          notification_id: string;
          provider_error?: string;
          provider_ticket?: string;
          result_status: string;
        };
        Returns: undefined;
      };
      remove_profile_avatar: {
        Args: { expected_avatar_id: string };
        Returns: Json;
      };
      replace_daily_challenge_word: {
        Args: { active_assignment_id: string };
        Returns: Json;
      };
      report_public_content: {
        Args: {
          details?: string;
          reason: string;
          submission_id: string;
          target_kind: string;
        };
        Returns: Json;
      };
      report_submission_comment: {
        Args: { comment_id: string; details?: string; reason: string };
        Returns: Json;
      };
      reserve_profile_avatar: { Args: { request_id: string }; Returns: Json };
      reserve_submission: {
        Args: { assignment_id: string };
        Returns: {
          concept_id: string;
          created_at: string;
          daily_challenge_id: string;
          daily_challenge_word_id: string;
          deleted_at: string | null;
          expires_at: string;
          id: string;
          reference_term: string;
          reference_term_id: string;
          status: string;
          storage_path: string;
          submitted_at: string | null;
          target_term: string;
          updated_at: string;
          user_id: string;
          visibility: string;
          vocabulary_term_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'submissions';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      save_notification_preferences: {
        Args: {
          daily_at: string;
          daily_enabled: boolean;
          notifications_enabled: boolean;
          streak_at: string;
          streak_enabled: boolean;
        };
        Returns: Json;
      };
      search_public_profiles: {
        Args: { after_id?: string; after_username?: string; prefix: string };
        Returns: Json;
      };
      set_follow: {
        Args: { following: boolean; profile_id: string };
        Returns: Json;
      };
      set_submission_visibility: {
        Args: { requested_visibility: string; submission_id: string };
        Returns: {
          concept_id: string;
          created_at: string;
          daily_challenge_id: string;
          daily_challenge_word_id: string;
          deleted_at: string | null;
          expires_at: string;
          id: string;
          reference_term: string;
          reference_term_id: string;
          status: string;
          storage_path: string;
          submitted_at: string | null;
          target_term: string;
          updated_at: string;
          user_id: string;
          visibility: string;
          vocabulary_term_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'submissions';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      sync_push_installation: {
        Args: {
          device_platform?: string;
          installation_id: string;
          installation_revision: number;
          installation_secret: string;
          push_token?: string;
        };
        Returns: undefined;
      };
      unblock_user: { Args: { block_id: string }; Returns: Json };
      update_learning_preferences: {
        Args: {
          cefr_level: string;
          reference_language_id: string;
          target_language_id: string;
          timezone: string;
        };
        Returns: Json;
      };
      update_my_profile: { Args: { username: string }; Returns: Json };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
