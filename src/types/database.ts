export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
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
      profiles: {
        Row: {
          created_at: string;
          id: string;
          onboarding_completed_at: string | null;
          updated_at: string;
          username: string | null;
        };
        Insert: {
          created_at?: string;
          id: string;
          onboarding_completed_at?: string | null;
          updated_at?: string;
          username?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          onboarding_completed_at?: string | null;
          updated_at?: string;
          username?: string | null;
        };
        Relationships: [];
      };
      submissions: {
        Row: {
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
      can_upload_submission_object: {
        Args: { object_path: string };
        Returns: boolean;
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
      get_my_progress: { Args: { challenge_id?: string }; Returns: Json };
      get_or_create_today_challenge: { Args: never; Returns: Json };
      get_submission_xp: { Args: { submission_id: string }; Returns: Json };
      photo_verification_target: {
        Args: { expected_user_id: string; submission_id: string };
        Returns: Json;
      };
      replace_daily_challenge_word: {
        Args: { active_assignment_id: string };
        Returns: Json;
      };
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
