export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string
          actor_user_id: string | null
          after_data: Json | null
          before_data: Json | null
          entity_id: string
          entity_type: string
          id: string
          occurred_at: string
          organization_id: string
          reason: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          entity_id: string
          entity_type: string
          id?: string
          occurred_at?: string
          organization_id: string
          reason?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          entity_id?: string
          entity_type?: string
          id?: string
          occurred_at?: string
          organization_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          display_name: string
          email: string
          id: string
          invited_by: string
          organization_id: string
          phone: string | null
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          display_name: string
          email: string
          id?: string
          invited_by: string
          organization_id: string
          phone?: string | null
          status?: string
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          display_name?: string
          email?: string
          id?: string
          invited_by?: string
          organization_id?: string
          phone?: string | null
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_location_updates: {
        Row: {
          accuracy_meters: number | null
          assignment_id: string
          created_at: string
          driver_id: string
          id: string
          latitude: number
          longitude: number
          organization_id: string
          recorded_at: string
          trip_id: string
        }
        Insert: {
          accuracy_meters?: number | null
          assignment_id: string
          created_at?: string
          driver_id: string
          id?: string
          latitude: number
          longitude: number
          organization_id: string
          recorded_at?: string
          trip_id: string
        }
        Update: {
          accuracy_meters?: number | null
          assignment_id?: string
          created_at?: string
          driver_id?: string
          id?: string
          latitude?: number
          longitude?: number
          organization_id?: string
          recorded_at?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_location_updates_assignment_id_organization_id_fkey"
            columns: ["assignment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "trip_assignments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "driver_location_updates_driver_id_organization_id_fkey"
            columns: ["driver_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "driver_location_updates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_location_updates_trip_id_organization_id_fkey"
            columns: ["trip_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      driver_unavailability_windows: {
        Row: {
          created_at: string
          driver_id: string
          ends_at: string
          id: string
          organization_id: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          ends_at: string
          id?: string
          organization_id: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          ends_at?: string
          id?: string
          organization_id?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_unavailability_windows_driver_fkey"
            columns: ["driver_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      driver_weekly_schedules: {
        Row: {
          configured_at: string
          driver_id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          configured_at?: string
          driver_id: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          configured_at?: string
          driver_id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_weekly_schedules_driver_fkey"
            columns: ["driver_id", "organization_id"]
            isOneToOne: true
            referencedRelation: "drivers"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      driver_weekly_shifts: {
        Row: {
          driver_id: string
          end_time: string
          id: string
          organization_id: string
          start_time: string
          weekday: number
        }
        Insert: {
          driver_id: string
          end_time: string
          id?: string
          organization_id: string
          start_time: string
          weekday: number
        }
        Update: {
          driver_id?: string
          end_time?: string
          id?: string
          organization_id?: string
          start_time?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "driver_weekly_shifts_schedule_fkey"
            columns: ["driver_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "driver_weekly_schedules"
            referencedColumns: ["driver_id", "organization_id"]
          },
        ]
      }
      drivers: {
        Row: {
          created_at: string
          display_name: string
          id: string
          organization_id: string
          phone: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          organization_id: string
          phone?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          organization_id?: string
          phone?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          created_at: string
          id: string
          name: string
          organization_id: string
          postal_code: string | null
          state: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string
          id?: string
          name: string
          organization_id: string
          postal_code?: string | null
          state?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          postal_code?: string | null
          state?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facilities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_module_grants: {
        Row: {
          access: string
          granted_at: string
          granted_by: string
          id: string
          membership_id: string
          module: string
          organization_id: string
          revoked_at: string | null
          revoked_by: string | null
        }
        Insert: {
          access: string
          granted_at?: string
          granted_by: string
          id?: string
          membership_id: string
          module: string
          organization_id: string
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Update: {
          access?: string
          granted_at?: string
          granted_by?: string
          id?: string
          membership_id?: string
          module?: string
          organization_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "membership_module_grants_membership_fkey"
            columns: ["membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "membership_module_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_events: {
        Row: {
          attempted_at: string | null
          completed_at: string | null
          created_at: string
          entity_id: string
          entity_type: string
          event_type: string
          failed_count: number
          failure_reason: string | null
          id: string
          organization_id: string
          recipient_count: number
          sent_count: number
          status: string
        }
        Insert: {
          attempted_at?: string | null
          completed_at?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          event_type: string
          failed_count?: number
          failure_reason?: string | null
          id?: string
          organization_id: string
          recipient_count?: number
          sent_count?: number
          status?: string
        }
        Update: {
          attempted_at?: string | null
          completed_at?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          event_type?: string
          failed_count?: number
          failure_reason?: string | null
          id?: string
          organization_id?: string
          recipient_count?: number
          sent_count?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_modules: {
        Row: {
          access_ends_at: string | null
          created_at: string
          module: string
          organization_id: string
          restriction: string | null
          status: string
          status_reason: string
          trial_ends_at: string | null
          trial_extension_count: number
          trial_started_at: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          access_ends_at?: string | null
          created_at?: string
          module: string
          organization_id: string
          restriction?: string | null
          status: string
          status_reason: string
          trial_ends_at?: string | null
          trial_extension_count?: number
          trial_started_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          access_ends_at?: string | null
          created_at?: string
          module?: string
          organization_id?: string
          restriction?: string | null
          status?: string
          status_reason?: string
          trial_ends_at?: string | null
          trial_extension_count?: number
          trial_started_at?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_modules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_notification_settings: {
        Row: {
          event_type: string
          organization_id: string
          recipient_roles: string[]
          updated_at: string
        }
        Insert: {
          event_type: string
          organization_id: string
          recipient_roles: string[]
          updated_at?: string
        }
        Update: {
          event_type?: string
          organization_id?: string
          recipient_roles?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_notification_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_service_offerings: {
        Row: {
          created_at: string
          organization_id: string
          service_type: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          service_type: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          service_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_service_offerings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          business_address: string | null
          business_email: string | null
          business_phone: string | null
          business_stage: string | null
          created_at: string
          default_trip_duration_minutes: number | null
          id: string
          name: string
          operating_closes_at: string | null
          operating_days: number[] | null
          operating_opens_at: string | null
          primary_contact_name: string | null
          service_area_description: string | null
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          business_address?: string | null
          business_email?: string | null
          business_phone?: string | null
          business_stage?: string | null
          created_at?: string
          default_trip_duration_minutes?: number | null
          id?: string
          name: string
          operating_closes_at?: string | null
          operating_days?: number[] | null
          operating_opens_at?: string | null
          primary_contact_name?: string | null
          service_area_description?: string | null
          status?: string
          timezone: string
          updated_at?: string
        }
        Update: {
          business_address?: string | null
          business_email?: string | null
          business_phone?: string | null
          business_stage?: string | null
          created_at?: string
          default_trip_duration_minutes?: number | null
          id?: string
          name?: string
          operating_closes_at?: string | null
          operating_days?: number[] | null
          operating_opens_at?: string | null
          primary_contact_name?: string | null
          service_area_description?: string | null
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      passengers: {
        Row: {
          assistance_notes: string | null
          created_at: string
          display_name: string
          id: string
          organization_id: string
          phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assistance_notes?: string | null
          created_at?: string
          display_name: string
          id?: string
          organization_id: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assistance_notes?: string | null
          created_at?: string
          display_name?: string
          id?: string
          organization_id?: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "passengers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admin_grants: {
        Row: {
          granted_at: string
          granted_by: string | null
          id: string
          note: string | null
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          note?: string | null
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          note?: string | null
          user_id?: string
        }
        Relationships: []
      }
      plus_activities: {
        Row: {
          activity_type: string
          actor_user_id: string
          body: string | null
          contact_id: string | null
          from_stage: string | null
          id: string
          occurred_at: string
          opportunity_id: string | null
          organization_id: string
          recorded_at: string
          request_id: string | null
          to_stage: string | null
        }
        Insert: {
          activity_type: string
          actor_user_id: string
          body?: string | null
          contact_id?: string | null
          from_stage?: string | null
          id?: string
          occurred_at?: string
          opportunity_id?: string | null
          organization_id: string
          recorded_at?: string
          request_id?: string | null
          to_stage?: string | null
        }
        Update: {
          activity_type?: string
          actor_user_id?: string
          body?: string | null
          contact_id?: string | null
          from_stage?: string | null
          id?: string
          occurred_at?: string
          opportunity_id?: string | null
          organization_id?: string
          recorded_at?: string
          request_id?: string | null
          to_stage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plus_activities_contact_fkey"
            columns: ["contact_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "plus_contacts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "plus_activities_opportunity_fkey"
            columns: ["opportunity_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "plus_opportunities"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "plus_activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plus_activities_request_fkey"
            columns: ["request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "transportation_requests"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      plus_agent_recommendations: {
        Row: {
          approved_task_id: string | null
          condition_key: string
          created_at: string
          generated_by: string
          generation_source: string
          id: string
          last_activity_at: string | null
          opportunity_id: string
          organization_id: string
          proposed_action: string
          recommendation_type: string
          reviewed_at: string | null
          reviewed_by: string | null
          signal_days: number
          status: string
          updated_at: string
        }
        Insert: {
          approved_task_id?: string | null
          condition_key: string
          created_at?: string
          generated_by: string
          generation_source?: string
          id?: string
          last_activity_at?: string | null
          opportunity_id: string
          organization_id: string
          proposed_action?: string
          recommendation_type: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          signal_days: number
          status?: string
          updated_at?: string
        }
        Update: {
          approved_task_id?: string | null
          condition_key?: string
          created_at?: string
          generated_by?: string
          generation_source?: string
          id?: string
          last_activity_at?: string | null
          opportunity_id?: string
          organization_id?: string
          proposed_action?: string
          recommendation_type?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          signal_days?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plus_agent_recommendations_opportunity_fkey"
            columns: ["opportunity_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "plus_opportunities"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "plus_agent_recommendations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plus_agent_recommendations_task_fkey"
            columns: ["approved_task_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "plus_tasks"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      plus_contacts: {
        Row: {
          contact_kind: string
          created_at: string
          created_by: string
          display_name: string
          do_not_contact: boolean
          email: string | null
          id: string
          job_title: string | null
          organization_id: string
          owner_user_id: string | null
          phone: string | null
          preferred_channel: string
          status: string
          updated_at: string
        }
        Insert: {
          contact_kind: string
          created_at?: string
          created_by: string
          display_name: string
          do_not_contact?: boolean
          email?: string | null
          id?: string
          job_title?: string | null
          organization_id: string
          owner_user_id?: string | null
          phone?: string | null
          preferred_channel?: string
          status?: string
          updated_at?: string
        }
        Update: {
          contact_kind?: string
          created_at?: string
          created_by?: string
          display_name?: string
          do_not_contact?: boolean
          email?: string | null
          id?: string
          job_title?: string | null
          organization_id?: string
          owner_user_id?: string | null
          phone?: string | null
          preferred_channel?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plus_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plus_opportunities: {
        Row: {
          campaign_code: string | null
          channel: string
          closed_at: string | null
          converted_at: string | null
          created_at: string
          created_by: string
          estimated_value_cents: number | null
          id: string
          inquiry_type: string | null
          lost_note: string | null
          lost_reason: string | null
          organization_id: string
          owner_user_id: string | null
          payment_reported_status: string
          primary_contact_id: string | null
          service_type: string | null
          source: string
          source_detail: string | null
          stage: string
          title: string
          updated_at: string
        }
        Insert: {
          campaign_code?: string | null
          channel?: string
          closed_at?: string | null
          converted_at?: string | null
          created_at?: string
          created_by: string
          estimated_value_cents?: number | null
          id?: string
          inquiry_type?: string | null
          lost_note?: string | null
          lost_reason?: string | null
          organization_id: string
          owner_user_id?: string | null
          payment_reported_status?: string
          primary_contact_id?: string | null
          service_type?: string | null
          source: string
          source_detail?: string | null
          stage?: string
          title: string
          updated_at?: string
        }
        Update: {
          campaign_code?: string | null
          channel?: string
          closed_at?: string | null
          converted_at?: string | null
          created_at?: string
          created_by?: string
          estimated_value_cents?: number | null
          id?: string
          inquiry_type?: string | null
          lost_note?: string | null
          lost_reason?: string | null
          organization_id?: string
          owner_user_id?: string | null
          payment_reported_status?: string
          primary_contact_id?: string | null
          service_type?: string | null
          source?: string
          source_detail?: string | null
          stage?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plus_opportunities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plus_opportunities_primary_contact_fkey"
            columns: ["primary_contact_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "plus_contacts"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      plus_request_attributions: {
        Row: {
          contact_id: string | null
          conversion_idempotency_key: string | null
          link_method: string
          linked_at: string
          linked_by: string
          opportunity_id: string | null
          organization_id: string
          request_id: string
          updated_at: string
        }
        Insert: {
          contact_id?: string | null
          conversion_idempotency_key?: string | null
          link_method: string
          linked_at?: string
          linked_by: string
          opportunity_id?: string | null
          organization_id: string
          request_id: string
          updated_at?: string
        }
        Update: {
          contact_id?: string | null
          conversion_idempotency_key?: string | null
          link_method?: string
          linked_at?: string
          linked_by?: string
          opportunity_id?: string | null
          organization_id?: string
          request_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plus_request_attributions_contact_fkey"
            columns: ["contact_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "plus_contacts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "plus_request_attributions_opportunity_fkey"
            columns: ["opportunity_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "plus_opportunities"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "plus_request_attributions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plus_request_attributions_request_fkey"
            columns: ["request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "transportation_requests"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      plus_tasks: {
        Row: {
          assignee_user_id: string | null
          completed_at: string | null
          completed_by: string | null
          contact_id: string | null
          created_at: string
          created_by: string
          due_at: string | null
          id: string
          opportunity_id: string | null
          organization_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_user_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          contact_id?: string | null
          created_at?: string
          created_by: string
          due_at?: string | null
          id?: string
          opportunity_id?: string | null
          organization_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_user_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string
          due_at?: string | null
          id?: string
          opportunity_id?: string | null
          organization_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plus_tasks_contact_fkey"
            columns: ["contact_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "plus_contacts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "plus_tasks_opportunity_fkey"
            columns: ["opportunity_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "plus_opportunities"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "plus_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      public_intake_rate_limit_events: {
        Row: {
          client_key: string
          id: number
          integration_external_id: string
          occurred_at: string
        }
        Insert: {
          client_key: string
          id?: never
          integration_external_id: string
          occurred_at?: string
        }
        Update: {
          client_key?: string
          id?: never
          integration_external_id?: string
          occurred_at?: string
        }
        Relationships: []
      }
      recurring_arrangements: {
        Row: {
          created_at: string
          created_by: string | null
          days_of_week: number[]
          destination_description: string
          end_date: string | null
          ended_at: string | null
          ended_reason: string | null
          id: string
          organization_id: string
          passenger_id: string
          paused_at: string | null
          pickup_description: string
          pickup_time: string
          request_id: string | null
          requires_wheelchair_access: boolean | null
          start_date: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          days_of_week: number[]
          destination_description: string
          end_date?: string | null
          ended_at?: string | null
          ended_reason?: string | null
          id?: string
          organization_id: string
          passenger_id: string
          paused_at?: string | null
          pickup_description: string
          pickup_time: string
          request_id?: string | null
          requires_wheelchair_access?: boolean | null
          start_date: string
          status?: string
          timezone: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          days_of_week?: number[]
          destination_description?: string
          end_date?: string | null
          ended_at?: string | null
          ended_reason?: string | null
          id?: string
          organization_id?: string
          passenger_id?: string
          paused_at?: string | null
          pickup_description?: string
          pickup_time?: string
          request_id?: string | null
          requires_wheelchair_access?: boolean | null
          start_date?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_arrangements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_arrangements_passenger_id_organization_id_fkey"
            columns: ["passenger_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "passengers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "recurring_arrangements_request_id_organization_id_fkey"
            columns: ["request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "transportation_requests"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      recurring_occurrence_exceptions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          reason: string
          recurring_arrangement_id: string
          service_date: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          reason: string
          recurring_arrangement_id: string
          service_date: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          reason?: string
          recurring_arrangement_id?: string
          service_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_occurrence_exceptio_recurring_arrangement_id_org_fkey"
            columns: ["recurring_arrangement_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "recurring_arrangements"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "recurring_occurrence_exceptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      request_acquisition_attributions: {
        Row: {
          created_at: string
          form_version: string | null
          id: string
          landing_path: string | null
          organization_id: string
          referrer_host: string | null
          request_id: string
          submission_path: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          created_at?: string
          form_version?: string | null
          id?: string
          landing_path?: string | null
          organization_id: string
          referrer_host?: string | null
          request_id: string
          submission_path?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          created_at?: string
          form_version?: string | null
          id?: string
          landing_path?: string | null
          organization_id?: string
          referrer_host?: string | null
          request_id?: string
          submission_path?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "request_acquisition_attributions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_acquisition_attributions_request_fkey"
            columns: ["request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "transportation_requests"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      request_events: {
        Row: {
          actor_user_id: string | null
          event_type: string
          id: string
          metadata: Json
          occurred_at: string
          organization_id: string
          reason_code: string | null
          reason_note: string | null
          request_id: string
        }
        Insert: {
          actor_user_id?: string | null
          event_type: string
          id?: string
          metadata?: Json
          occurred_at?: string
          organization_id: string
          reason_code?: string | null
          reason_note?: string | null
          request_id: string
        }
        Update: {
          actor_user_id?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          organization_id?: string
          reason_code?: string | null
          reason_note?: string | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_events_request_id_organization_id_fkey"
            columns: ["request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "transportation_requests"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      request_intake_integrations: {
        Row: {
          allowed_origins: string[] | null
          connection_method: string | null
          created_at: string
          external_id: string
          id: string
          integration_type: string
          is_active: boolean
          organization_id: string
          retired_at: string | null
          updated_at: string
          website_manager: string | null
        }
        Insert: {
          allowed_origins?: string[] | null
          connection_method?: string | null
          created_at?: string
          external_id: string
          id?: string
          integration_type?: string
          is_active?: boolean
          organization_id: string
          retired_at?: string | null
          updated_at?: string
          website_manager?: string | null
        }
        Update: {
          allowed_origins?: string[] | null
          connection_method?: string | null
          created_at?: string
          external_id?: string
          id?: string
          integration_type?: string
          is_active?: boolean
          organization_id?: string
          retired_at?: string | null
          updated_at?: string
          website_manager?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "request_intake_integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          role: string
          status: string
          token_hash: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          organization_id: string
          role: string
          status?: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          role?: string
          status?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      transportation_requests: {
        Row: {
          additional_notes: string | null
          assistance_notes: string | null
          created_at: string
          destination_description: string
          external_submission_ref: string | null
          id: string
          intake_integration_id: string | null
          organization_id: string
          passenger_id: string | null
          pickup_description: string
          preferred_date: string | null
          preferred_time: string | null
          recurring_appointment_time: string | null
          recurring_days_of_week: number[] | null
          recurring_end_date: string | null
          recurring_return_trip_expected: boolean | null
          recurring_start_date: string | null
          requested_passenger_name: string | null
          requester_email: string | null
          requester_name: string
          requester_phone: string
          requester_relationship: string
          requester_user_id: string | null
          return_trip_needed: string
          service_type: string | null
          source: string
          state: string
          updated_at: string
        }
        Insert: {
          additional_notes?: string | null
          assistance_notes?: string | null
          created_at?: string
          destination_description: string
          external_submission_ref?: string | null
          id?: string
          intake_integration_id?: string | null
          organization_id: string
          passenger_id?: string | null
          pickup_description: string
          preferred_date?: string | null
          preferred_time?: string | null
          recurring_appointment_time?: string | null
          recurring_days_of_week?: number[] | null
          recurring_end_date?: string | null
          recurring_return_trip_expected?: boolean | null
          recurring_start_date?: string | null
          requested_passenger_name?: string | null
          requester_email?: string | null
          requester_name: string
          requester_phone: string
          requester_relationship: string
          requester_user_id?: string | null
          return_trip_needed: string
          service_type?: string | null
          source?: string
          state?: string
          updated_at?: string
        }
        Update: {
          additional_notes?: string | null
          assistance_notes?: string | null
          created_at?: string
          destination_description?: string
          external_submission_ref?: string | null
          id?: string
          intake_integration_id?: string | null
          organization_id?: string
          passenger_id?: string | null
          pickup_description?: string
          preferred_date?: string | null
          preferred_time?: string | null
          recurring_appointment_time?: string | null
          recurring_days_of_week?: number[] | null
          recurring_end_date?: string | null
          recurring_return_trip_expected?: boolean | null
          recurring_start_date?: string | null
          requested_passenger_name?: string | null
          requester_email?: string | null
          requester_name?: string
          requester_phone?: string
          requester_relationship?: string
          requester_user_id?: string | null
          return_trip_needed?: string
          service_type?: string | null
          source?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transportation_requests_intake_integration_fkey"
            columns: ["intake_integration_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "request_intake_integrations"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "transportation_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transportation_requests_passenger_id_fkey"
            columns: ["passenger_id"]
            isOneToOne: false
            referencedRelation: "passengers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transportation_requests_passenger_id_organization_id_fkey"
            columns: ["passenger_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "passengers"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      trip_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          created_at: string
          driver_id: string
          end_reason: string | null
          ended_at: string | null
          id: string
          organization_id: string
          trip_id: string
          vehicle_id: string | null
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          driver_id: string
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          organization_id: string
          trip_id: string
          vehicle_id?: string | null
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          driver_id?: string
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          organization_id?: string
          trip_id?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trip_assignments_driver_id_organization_id_fkey"
            columns: ["driver_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "trip_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_assignments_trip_id_organization_id_fkey"
            columns: ["trip_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "trip_assignments_vehicle_id_organization_id_fkey"
            columns: ["vehicle_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      trip_events: {
        Row: {
          actor_user_id: string | null
          event_type: string
          id: string
          metadata: Json
          occurred_at: string
          organization_id: string
          trip_id: string
        }
        Insert: {
          actor_user_id?: string | null
          event_type: string
          id?: string
          metadata?: Json
          occurred_at?: string
          organization_id: string
          trip_id: string
        }
        Update: {
          actor_user_id?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          organization_id?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_events_trip_id_organization_id_fkey"
            columns: ["trip_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      trip_exceptions: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          exception_type: string | null
          id: string
          organization_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          trip_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          exception_type?: string | null
          id?: string
          organization_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          trip_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          exception_type?: string | null
          id?: string
          organization_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_exceptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_exceptions_trip_id_organization_id_fkey"
            columns: ["trip_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      trip_notes: {
        Row: {
          author_user_id: string | null
          body: string
          created_at: string
          id: string
          organization_id: string
          trip_id: string
          updated_at: string
          visibility: string
        }
        Insert: {
          author_user_id?: string | null
          body: string
          created_at?: string
          id?: string
          organization_id: string
          trip_id: string
          updated_at?: string
          visibility: string
        }
        Update: {
          author_user_id?: string | null
          body?: string
          created_at?: string
          id?: string
          organization_id?: string
          trip_id?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_notes_trip_id_organization_id_fkey"
            columns: ["trip_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      trips: {
        Row: {
          appointment_at: string | null
          assistance_notes: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          destination_description: string
          destination_facility_id: string | null
          expected_duration_minutes: number | null
          expected_duration_source: string | null
          id: string
          instructions: string | null
          no_show_at: string | null
          organization_id: string
          passenger_id: string
          pickup_description: string
          pickup_facility_id: string | null
          recurring_arrangement_id: string | null
          request_id: string | null
          requires_wheelchair_access: boolean | null
          scheduled_pickup_at: string | null
          state: string
          updated_at: string
        }
        Insert: {
          appointment_at?: string | null
          assistance_notes?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          destination_description: string
          destination_facility_id?: string | null
          expected_duration_minutes?: number | null
          expected_duration_source?: string | null
          id?: string
          instructions?: string | null
          no_show_at?: string | null
          organization_id: string
          passenger_id: string
          pickup_description: string
          pickup_facility_id?: string | null
          recurring_arrangement_id?: string | null
          request_id?: string | null
          requires_wheelchair_access?: boolean | null
          scheduled_pickup_at?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          appointment_at?: string | null
          assistance_notes?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          destination_description?: string
          destination_facility_id?: string | null
          expected_duration_minutes?: number | null
          expected_duration_source?: string | null
          id?: string
          instructions?: string | null
          no_show_at?: string | null
          organization_id?: string
          passenger_id?: string
          pickup_description?: string
          pickup_facility_id?: string | null
          recurring_arrangement_id?: string | null
          request_id?: string | null
          requires_wheelchair_access?: boolean | null
          scheduled_pickup_at?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trips_destination_facility_id_organization_id_fkey"
            columns: ["destination_facility_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "trips_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_passenger_id_organization_id_fkey"
            columns: ["passenger_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "passengers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "trips_pickup_facility_id_organization_id_fkey"
            columns: ["pickup_facility_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "trips_recurring_arrangement_id_org_fkey"
            columns: ["recurring_arrangement_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "recurring_arrangements"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "trips_request_id_organization_id_fkey"
            columns: ["request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "transportation_requests"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      vehicle_unavailability_windows: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          organization_id: string
          starts_at: string
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          organization_id: string
          starts_at: string
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          organization_id?: string
          starts_at?: string
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_unavailability_windows_vehicle_fkey"
            columns: ["vehicle_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      vehicles: {
        Row: {
          created_at: string
          id: string
          label: string
          organization_id: string
          seated_capacity: number | null
          status: string
          updated_at: string
          wheelchair_lift: boolean | null
          wheelchair_positions: number | null
          wheelchair_ramp: boolean | null
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          organization_id: string
          seated_capacity?: number | null
          status?: string
          updated_at?: string
          wheelchair_lift?: boolean | null
          wheelchair_positions?: number | null
          wheelchair_ramp?: boolean | null
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          organization_id?: string
          seated_capacity?: number | null
          status?: string
          updated_at?: string
          wheelchair_lift?: boolean | null
          wheelchair_positions?: number | null
          wheelchair_ramp?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      website_request_form_publications: {
        Row: {
          allow_recurring: boolean
          confirmation_message: string
          created_at: string
          form_id: string
          id: string
          intake_integration_id: string
          intro_text: string | null
          offered_service_types: string[] | null
          organization_id: string
          public_key: string
          published_at: string
          published_version: number
          published_versions: number[]
          require_service_choice: boolean
          status: string
          submit_label: string
          title: string
          updated_at: string
        }
        Insert: {
          allow_recurring: boolean
          confirmation_message: string
          created_at?: string
          form_id: string
          id?: string
          intake_integration_id: string
          intro_text?: string | null
          offered_service_types?: string[] | null
          organization_id: string
          public_key: string
          published_at?: string
          published_version: number
          published_versions: number[]
          require_service_choice: boolean
          status?: string
          submit_label: string
          title: string
          updated_at?: string
        }
        Update: {
          allow_recurring?: boolean
          confirmation_message?: string
          created_at?: string
          form_id?: string
          id?: string
          intake_integration_id?: string
          intro_text?: string | null
          offered_service_types?: string[] | null
          organization_id?: string
          public_key?: string
          published_at?: string
          published_version?: number
          published_versions?: number[]
          require_service_choice?: boolean
          status?: string
          submit_label?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_request_form_publications_form_fk"
            columns: ["form_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "website_request_forms"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "website_request_form_publications_integration_fk"
            columns: ["intake_integration_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "request_intake_integrations"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "website_request_form_publications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      website_request_forms: {
        Row: {
          allow_recurring: boolean
          confirmation_message: string
          created_at: string
          id: string
          intro_text: string | null
          offered_service_types: string[] | null
          organization_id: string
          require_service_choice: boolean
          status: string
          submit_label: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          allow_recurring?: boolean
          confirmation_message: string
          created_at?: string
          id?: string
          intro_text?: string | null
          offered_service_types?: string[] | null
          organization_id: string
          require_service_choice?: boolean
          status?: string
          submit_label: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          allow_recurring?: boolean
          confirmation_message?: string
          created_at?: string
          id?: string
          intro_text?: string | null
          offered_service_types?: string[] | null
          organization_id?: string
          require_service_choice?: boolean
          status?: string
          submit_label?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "website_request_forms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _create_public_request: {
        Args: {
          p_acquisition?: Json
          p_additional_notes?: string
          p_assistance_notes?: string
          p_destination_description: string
          p_idempotency_key: string
          p_integration_id: string
          p_pickup_description: string
          p_preferred_date?: string
          p_preferred_time?: string
          p_recurring_appointment_time?: string
          p_recurring_days_of_week?: string[]
          p_recurring_end_date?: string
          p_recurring_return_trip_expected?: boolean
          p_recurring_start_date?: string
          p_requested_passenger_name?: string
          p_requester_email?: string
          p_requester_name: string
          p_requester_phone: string
          p_requester_relationship: string
          p_return_trip_needed: string
          p_service_type?: string
        }
        Returns: Database["public"]["CompositeTypes"]["public_request_submission_result"]
        SetofOptions: {
          from: "*"
          to: "public_request_submission_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _driver_execute_trip_transition: {
        Args: {
          p_close_assignment?: boolean
          p_event_type: string
          p_expected_current_state: string
          p_from_state: string
          p_to_state: string
          p_trip_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["trip_transition_result"]
        SetofOptions: {
          from: "*"
          to: "trip_transition_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _enqueue_notification_event: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_event_type: string
          p_organization_id: string
        }
        Returns: string
      }
      _generate_intake_external_id: { Args: never; Returns: string }
      _generate_staff_invite_token: { Args: never; Returns: string }
      _is_canonical_days_of_week: {
        Args: { p_days: number[] }
        Returns: boolean
      }
      _is_valid_trip_transition: {
        Args: { p_from_state: string; p_to_state: string }
        Returns: boolean
      }
      _lock_driver_active_assignment: {
        Args: { p_organization_id: string; p_trip_id: string }
        Returns: {
          assigned_at: string
          assigned_by: string | null
          created_at: string
          driver_id: string
          end_reason: string | null
          ended_at: string | null
          id: string
          organization_id: string
          trip_id: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "trip_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _lock_org_admins: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      _normalize_website_origin: { Args: { p_origin: string }; Returns: string }
      _notification_default_roles: {
        Args: { p_event_type: string }
        Returns: string[]
      }
      _organization_local_to_utc: {
        Args: { p_date: string; p_time: string; p_timezone: string }
        Returns: {
          status: string
          utc: string
        }[]
      }
      _plus_agent_candidates: {
        Args: { p_opportunity_id: string; p_organization_id: string }
        Returns: {
          condition_key: string
          last_activity_at: string
          opportunity_id: string
          recommendation_type: string
          signal_days: number
        }[]
      }
      _plus_agent_review: {
        Args: { p_actor: string; p_organization_id: string; p_source: string }
        Returns: Database["public"]["CompositeTypes"]["plus_agent_review_result"]
        SetofOptions: {
          from: "*"
          to: "plus_agent_review_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _plus_agent_threshold: { Args: { p_key: string }; Returns: number }
      _plus_contact_matches: {
        Args: {
          p_display_name: string
          p_email: string
          p_exclude_contact_id: string
          p_organization_id: string
          p_phone: string
        }
        Returns: {
          contact_id: string
          display_name: string
          match_on: string
          status: string
        }[]
      }
      _plus_core_request_source: {
        Args: { p_opportunity_source: string }
        Returns: string
      }
      _plus_entitlement_state: {
        Args: { p_organization_id: string }
        Returns: string
      }
      _plus_insert_task: {
        Args: {
          p_actor: string
          p_assignee_user_id: string
          p_contact_id: string
          p_due_at: string
          p_opportunity_id: string
          p_organization_id: string
          p_title: string
        }
        Returns: string
      }
      _plus_member_access: {
        Args: { p_organization_id: string }
        Returns: string
      }
      _plus_org_day_bounds: {
        Args: { p_organization_id: string }
        Returns: {
          day_end: string
          day_start: string
        }[]
      }
      _plus_require_active_contact: {
        Args: { p_contact_id: string; p_organization_id: string }
        Returns: string
      }
      _plus_require_core_request_read: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      _plus_require_idempotency_key: {
        Args: { p_key: string }
        Returns: string
      }
      _plus_require_task_subject: {
        Args: {
          p_contact_id: string
          p_opportunity_id: string
          p_organization_id: string
        }
        Returns: undefined
      }
      _plus_resolve_attribution: {
        Args: {
          p_contact_id: string
          p_keep_contact_id: string
          p_opportunity_id: string
          p_organization_id: string
        }
        Returns: Record<string, unknown>
      }
      _plus_resolve_owner: {
        Args: { p_organization_id: string; p_owner_membership_id: string }
        Returns: string
      }
      _plus_staff_name: { Args: { p_user_id: string }; Returns: string }
      _plus_user_can_write: {
        Args: { p_organization_id: string; p_user_id: string }
        Returns: boolean
      }
      _public_form_service_types: {
        Args: { p_offered: string[]; p_organization_id: string }
        Returns: string[]
      }
      _require_platform_admin: { Args: never; Returns: undefined }
      _require_plus_admin_write: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      _require_plus_write: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      _sanitize_acquisition: { Args: { p_acquisition: Json }; Returns: Json }
      _staff_invite_token_hash: { Args: { p_token: string }; Returns: string }
      _validate_request_decision_reason: {
        Args: {
          p_event_type: string
          p_reason_code: string
          p_reason_note: string
        }
        Returns: string
      }
      accept_staff_invite: {
        Args: { p_token: string }
        Returns: Database["public"]["CompositeTypes"]["staff_invite_acceptance_result"]
        SetofOptions: {
          from: "*"
          to: "staff_invite_acceptance_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      accept_transportation_request: {
        Args: { p_organization_id: string; p_request_id: string }
        Returns: Database["public"]["CompositeTypes"]["request_transition_result"]
        SetofOptions: {
          from: "*"
          to: "request_transition_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_trip: {
        Args: { p_driver_id: string; p_trip_id: string; p_vehicle_id?: string }
        Returns: Database["public"]["CompositeTypes"]["trip_assignment_result"]
        SetofOptions: {
          from: "*"
          to: "trip_assignment_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_staff_invite: { Args: { p_invite_id: string }; Returns: boolean }
      cancel_transportation_request: {
        Args: {
          p_organization_id: string
          p_reason_code: string
          p_reason_note?: string
          p_request_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["request_transition_result"]
        SetofOptions: {
          from: "*"
          to: "request_transition_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_trip: {
        Args: { p_reason: string; p_trip_id: string }
        Returns: Database["public"]["CompositeTypes"]["trip_transition_result"]
        SetofOptions: {
          from: "*"
          to: "trip_transition_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      change_membership_role: {
        Args: { p_membership_id: string; p_role: string }
        Returns: Database["public"]["CompositeTypes"]["membership_change_result"]
        SetofOptions: {
          from: "*"
          to: "membership_change_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      check_and_record_public_intake_rate_limit: {
        Args: { p_client_key: string; p_integration_external_id: string }
        Returns: Database["public"]["CompositeTypes"]["rate_limit_check_result"]
        SetofOptions: {
          from: "*"
          to: "rate_limit_check_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_notification_dispatch: {
        Args: { p_event_id: string }
        Returns: Json
      }
      clear_driver_weekly_schedule: {
        Args: { p_driver_id: string }
        Returns: Database["public"]["CompositeTypes"]["driver_schedule_result"]
        SetofOptions: {
          from: "*"
          to: "driver_schedule_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_notification_dispatch: {
        Args: {
          p_event_id: string
          p_failed: number
          p_reason: string
          p_sent: number
        }
        Returns: boolean
      }
      complete_pending_signup: {
        Args: never
        Returns: Database["public"]["CompositeTypes"]["organization_signup_result"]
        SetofOptions: {
          from: "*"
          to: "organization_signup_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_pending_signup_manual: {
        Args: { p_business_name: string; p_full_name: string }
        Returns: Database["public"]["CompositeTypes"]["organization_signup_result"]
        SetofOptions: {
          from: "*"
          to: "organization_signup_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_driver_invite: {
        Args: {
          p_display_name: string
          p_email: string
          p_organization_id: string
          p_phone?: string
        }
        Returns: Database["public"]["CompositeTypes"]["driver_invite_result"]
        SetofOptions: {
          from: "*"
          to: "driver_invite_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_recurring_arrangement: {
        Args: {
          p_days_of_week: number[]
          p_destination_description: string
          p_end_date?: string
          p_organization_id: string
          p_passenger_id: string
          p_pickup_description: string
          p_pickup_time: string
          p_request_id?: string
          p_requires_wheelchair_access?: boolean
          p_start_date: string
        }
        Returns: Database["public"]["CompositeTypes"]["recurring_arrangement_result"]
        SetofOptions: {
          from: "*"
          to: "recurring_arrangement_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_request_intake_integration: {
        Args: { p_organization_id: string; p_origin: string }
        Returns: Database["public"]["CompositeTypes"]["request_intake_integration_result"]
        SetofOptions: {
          from: "*"
          to: "request_intake_integration_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_staff_invite: {
        Args: { p_email: string; p_organization_id: string; p_role: string }
        Returns: Database["public"]["CompositeTypes"]["staff_invite_result"]
        SetofOptions: {
          from: "*"
          to: "staff_invite_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_trip: {
        Args: {
          p_appointment_at?: string
          p_assistance_notes?: string
          p_destination_description: string
          p_destination_facility_id?: string
          p_expected_duration_minutes?: number
          p_instructions?: string
          p_organization_id: string
          p_passenger_id: string
          p_pickup_description: string
          p_pickup_facility_id?: string
          p_request_id?: string
          p_requires_wheelchair_access?: boolean
          p_scheduled_pickup_at?: string
        }
        Returns: Database["public"]["CompositeTypes"]["trip_creation_result"]
        SetofOptions: {
          from: "*"
          to: "trip_creation_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_trip_for_recurring_occurrence: {
        Args: {
          p_arrangement_id: string
          p_organization_id: string
          p_service_date: string
        }
        Returns: Database["public"]["CompositeTypes"]["trip_creation_result"]
        SetofOptions: {
          from: "*"
          to: "trip_creation_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_driver_id: { Args: { p_org_id: string }; Returns: string }
      decline_transportation_request: {
        Args: {
          p_organization_id: string
          p_reason_code: string
          p_reason_note?: string
          p_request_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["request_transition_result"]
        SetofOptions: {
          from: "*"
          to: "request_transition_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_driver_unavailability: {
        Args: { p_window_id: string }
        Returns: Database["public"]["CompositeTypes"]["unavailability_window_result"]
        SetofOptions: {
          from: "*"
          to: "unavailability_window_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_unused_request_intake_integration: {
        Args: { p_integration_id: string }
        Returns: Database["public"]["CompositeTypes"]["website_connection_lifecycle_result"]
        SetofOptions: {
          from: "*"
          to: "website_connection_lifecycle_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_vehicle_unavailability: {
        Args: { p_window_id: string }
        Returns: Database["public"]["CompositeTypes"]["unavailability_window_result"]
        SetofOptions: {
          from: "*"
          to: "unavailability_window_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      disable_website_request_form_publication: {
        Args: { p_organization_id: string }
        Returns: Database["public"]["CompositeTypes"]["website_request_form_publish_result"]
        SetofOptions: {
          from: "*"
          to: "website_request_form_publish_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_arrive_at_destination: {
        Args: { p_expected_current_state: string; p_trip_id: string }
        Returns: Database["public"]["CompositeTypes"]["trip_transition_result"]
        SetofOptions: {
          from: "*"
          to: "trip_transition_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_arrive_at_pickup: {
        Args: { p_expected_current_state: string; p_trip_id: string }
        Returns: Database["public"]["CompositeTypes"]["trip_transition_result"]
        SetofOptions: {
          from: "*"
          to: "trip_transition_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_complete_trip: {
        Args: { p_expected_current_state: string; p_trip_id: string }
        Returns: Database["public"]["CompositeTypes"]["trip_transition_result"]
        SetofOptions: {
          from: "*"
          to: "trip_transition_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_get_own_schedule: {
        Args: { p_organization_id: string }
        Returns: Database["public"]["CompositeTypes"]["driver_own_schedule_result"]
        SetofOptions: {
          from: "*"
          to: "driver_own_schedule_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_get_profile: {
        Args: { p_organization_id: string }
        Returns: Database["public"]["CompositeTypes"]["driver_profile_result"]
        SetofOptions: {
          from: "*"
          to: "driver_profile_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_get_trip_detail: {
        Args: { p_trip_id: string }
        Returns: Database["public"]["CompositeTypes"]["driver_trip_detail_result"]
        SetofOptions: {
          from: "*"
          to: "driver_trip_detail_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_list_active_trips: {
        Args: { p_organization_id: string }
        Returns: Database["public"]["CompositeTypes"]["driver_active_trip_summary"][]
        SetofOptions: {
          from: "*"
          to: "driver_active_trip_summary"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      driver_list_trip_history: {
        Args: { p_from?: string; p_organization_id: string; p_to?: string }
        Returns: Database["public"]["CompositeTypes"]["driver_trip_history_entry"][]
        SetofOptions: {
          from: "*"
          to: "driver_trip_history_entry"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      driver_mark_passenger_onboard: {
        Args: { p_expected_current_state: string; p_trip_id: string }
        Returns: Database["public"]["CompositeTypes"]["trip_transition_result"]
        SetofOptions: {
          from: "*"
          to: "trip_transition_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_record_location: {
        Args: {
          p_accuracy_meters?: number
          p_latitude: number
          p_longitude: number
          p_trip_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["driver_location_result"]
        SetofOptions: {
          from: "*"
          to: "driver_location_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_start_to_destination: {
        Args: { p_expected_current_state: string; p_trip_id: string }
        Returns: Database["public"]["CompositeTypes"]["trip_transition_result"]
        SetofOptions: {
          from: "*"
          to: "trip_transition_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_start_to_pickup: {
        Args: { p_expected_current_state: string; p_trip_id: string }
        Returns: Database["public"]["CompositeTypes"]["trip_transition_result"]
        SetofOptions: {
          from: "*"
          to: "trip_transition_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      edit_recurring_arrangement: {
        Args: {
          p_arrangement_id: string
          p_days_of_week: number[]
          p_destination_description: string
          p_end_date?: string
          p_organization_id: string
          p_pickup_description: string
          p_pickup_time: string
          p_start_date: string
        }
        Returns: Database["public"]["CompositeTypes"]["recurring_arrangement_result"]
        SetofOptions: {
          from: "*"
          to: "recurring_arrangement_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      end_recurring_arrangement: {
        Args: {
          p_arrangement_id: string
          p_organization_id: string
          p_reason: string
        }
        Returns: Database["public"]["CompositeTypes"]["recurring_arrangement_result"]
        SetofOptions: {
          from: "*"
          to: "recurring_arrangement_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_driver_invite_preview: {
        Args: { p_token: string }
        Returns: Database["public"]["CompositeTypes"]["driver_invite_preview"]
        SetofOptions: {
          from: "*"
          to: "driver_invite_preview"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_notification_settings: {
        Args: { p_organization_id: string }
        Returns: {
          event_type: string
          is_default: boolean
          recipient_roles: string[]
        }[]
      }
      get_organization_service_offerings: {
        Args: { p_organization_id: string }
        Returns: string[]
      }
      get_public_request_form: {
        Args: { p_public_key: string }
        Returns: {
          allow_recurring: boolean
          confirmation_message: string
          form_version: number
          intro_text: string
          organization_name: string
          require_service_choice: boolean
          service_types: string[]
          submit_label: string
          title: string
        }[]
      }
      get_request_acquisition: {
        Args: { p_organization_id: string; p_request_id: string }
        Returns: {
          captured_at: string
          form_version: string
          landing_path: string
          referrer_host: string
          submission_path: string
          utm_campaign: string
          utm_content: string
          utm_medium: string
          utm_source: string
          utm_term: string
        }[]
      }
      get_staff_invite_preview: {
        Args: { p_token: string }
        Returns: Database["public"]["CompositeTypes"]["staff_invite_preview"]
        SetofOptions: {
          from: "*"
          to: "staff_invite_preview"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_website_request_form: {
        Args: { p_organization_id: string }
        Returns: {
          allow_recurring: boolean
          confirmation_message: string
          intro_text: string
          offered_service_types: string[]
          require_service_choice: boolean
          status: string
          submit_label: string
          title: string
          updated_at: string
          version: number
        }[]
      }
      get_website_request_form_publication: {
        Args: { p_organization_id: string }
        Returns: Database["public"]["CompositeTypes"]["website_request_form_publication_state"][]
        SetofOptions: {
          from: "*"
          to: "website_request_form_publication_state"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      has_org_role: {
        Args: { p_org_id: string; p_roles: string[] }
        Returns: boolean
      }
      is_driver_assigned_to_trip: {
        Args: { p_trip_id: string }
        Returns: boolean
      }
      is_org_member: { Args: { p_org_id: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      is_valid_iana_timezone: { Args: { p_timezone: string }; Returns: boolean }
      link_request_passenger: {
        Args: {
          p_organization_id: string
          p_passenger_id: string
          p_request_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["request_passenger_link_result"]
        SetofOptions: {
          from: "*"
          to: "request_passenger_link_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      link_self_as_driver: {
        Args: {
          p_display_name: string
          p_organization_id: string
          p_phone?: string
        }
        Returns: Database["public"]["CompositeTypes"]["owner_driver_link_result"]
        SetofOptions: {
          from: "*"
          to: "owner_driver_link_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      list_activity_events: {
        Args: {
          p_before_at?: string
          p_before_id?: string
          p_limit?: number
          p_organization_id: string
        }
        Returns: {
          action: string
          actor_name: string
          after_data: Json
          before_data: Json
          id: string
          occurred_at: string
        }[]
      }
      list_notification_history: {
        Args: { p_limit?: number; p_organization_id: string }
        Returns: {
          created_at: string
          event_type: string
          recipient_count: number
          sent_count: number
          status: string
        }[]
      }
      list_previous_website_connections: {
        Args: { p_organization_id: string }
        Returns: {
          connection_method: string
          request_count: number
          retired_at: string
          website: string
          website_manager: string
        }[]
      }
      list_request_intake_integrations: {
        Args: { p_organization_id: string }
        Returns: {
          allowed_origins: string[]
          connection_method: string
          created_at: string
          external_id: string
          id: string
          integration_type: string
          is_active: boolean
          last_request_received_at: string
          request_count: number
          website_manager: string
        }[]
      }
      list_staff_invites: {
        Args: { p_organization_id: string }
        Returns: {
          created_at: string
          email: string
          expires_at: string
          id: string
          role: string
          status: string
        }[]
      }
      list_team_members: {
        Args: { p_organization_id: string }
        Returns: {
          display_name: string
          email: string
          is_self: boolean
          joined_at: string
          membership_id: string
          role: string
          status: string
        }[]
      }
      log_transportation_request: {
        Args: {
          p_additional_notes?: string
          p_assistance_notes?: string
          p_destination_description: string
          p_organization_id: string
          p_passenger_id?: string
          p_pickup_description: string
          p_preferred_date?: string
          p_preferred_time?: string
          p_requester_email?: string
          p_requester_name: string
          p_requester_phone: string
          p_requester_relationship: string
          p_return_trip_needed: string
          p_service_type?: string
          p_source: string
        }
        Returns: Database["public"]["CompositeTypes"]["request_creation_result"]
        SetofOptions: {
          from: "*"
          to: "request_creation_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pause_recurring_arrangement: {
        Args: { p_arrangement_id: string; p_organization_id: string }
        Returns: Database["public"]["CompositeTypes"]["recurring_arrangement_result"]
        SetofOptions: {
          from: "*"
          to: "recurring_arrangement_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_extend_plus_trial:
        | {
            Args: {
              p_extra_days: number
              p_organization_id: string
              p_reason: string
            }
            Returns: Database["public"]["CompositeTypes"]["platform_organization_module_result"]
            SetofOptions: {
              from: "*"
              to: "platform_organization_module_result"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_expected_updated_at: string
              p_extra_days: number
              p_organization_id: string
              p_reason: string
            }
            Returns: Database["public"]["CompositeTypes"]["platform_organization_module_result"]
            SetofOptions: {
              from: "*"
              to: "platform_organization_module_result"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      platform_get_organization: {
        Args: { p_organization_id: string }
        Returns: {
          active_admin_count: number
          active_dispatcher_count: number
          active_driver_membership_count: number
          business_stage: string
          created_at: string
          driver_count: number
          integrations_active: number
          integrations_total: number
          last_activity_at: string
          last_failure_at: string
          last_failure_reason: string
          last_website_request_at: string
          name: string
          notif_dispatching: number
          notif_failed: number
          notif_partial: number
          notif_pending: number
          notif_sent: number
          notif_skipped: number
          notif_stuck: number
          organization_id: string
          passenger_count: number
          pending_staff_invite_count: number
          request_count: number
          status: string
          timezone: string
          trip_count: number
          vehicle_count: number
          website_request_count: number
        }[]
      }
      platform_get_organization_module: {
        Args: { p_module: string; p_organization_id: string }
        Returns: Database["public"]["CompositeTypes"]["platform_organization_module_state"]
        SetofOptions: {
          from: "*"
          to: "platform_organization_module_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_get_overview: {
        Args: never
        Returns: {
          active_organizations: number
          integrations_active: number
          integrations_total: number
          notifications_failed: number
          notifications_partial: number
          notifications_stuck: number
          platform_admin_count: number
          suspended_organizations: number
          total_organizations: number
        }[]
      }
      platform_list_activity: {
        Args: { p_before_at?: string; p_before_id?: string; p_limit?: number }
        Returns: {
          action: string
          actor_name: string
          id: string
          occurred_at: string
          organization_id: string
          organization_name: string
          reason: string
        }[]
      }
      platform_list_notification_attention: {
        Args: { p_limit?: number }
        Returns: {
          completed_at: string
          created_at: string
          event_type: string
          failure_reason: string
          is_stuck: boolean
          organization_id: string
          organization_name: string
          status: string
        }[]
      }
      platform_list_organization_integrations: {
        Args: { p_organization_id: string }
        Returns: {
          allowed_origins: string[]
          created_at: string
          is_active: boolean
          last_request_at: string
          request_count: number
        }[]
      }
      platform_list_organizations: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: string
        }
        Returns: {
          active_staff_count: number
          created_at: string
          driver_count: number
          integrations_active: number
          integrations_total: number
          last_activity_at: string
          name: string
          organization_id: string
          request_count: number
          status: string
          timezone: string
          total_count: number
          trip_count: number
        }[]
      }
      platform_set_organization_module:
        | {
            Args: {
              p_access_ends_at: string
              p_module: string
              p_organization_id: string
              p_reason: string
              p_restriction: string
              p_status: string
              p_trial_days: number
            }
            Returns: Database["public"]["CompositeTypes"]["platform_organization_module_result"]
            SetofOptions: {
              from: "*"
              to: "platform_organization_module_result"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_access_ends_at: string
              p_expected_updated_at: string
              p_module: string
              p_organization_id: string
              p_reason: string
              p_restriction: string
              p_status: string
              p_trial_days: number
            }
            Returns: Database["public"]["CompositeTypes"]["platform_organization_module_result"]
            SetofOptions: {
              from: "*"
              to: "platform_organization_module_result"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      plus_access_state: {
        Args: { p_organization_id: string }
        Returns: Database["public"]["CompositeTypes"]["plus_access_state_result"]
        SetofOptions: {
          from: "*"
          to: "plus_access_state_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_approve_agent_recommendation: {
        Args: {
          p_assignee_membership_id: string
          p_due_at: string
          p_expected_updated_at: string
          p_organization_id: string
          p_recommendation_id: string
          p_task_title: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_agent_review_outcome"]
        SetofOptions: {
          from: "*"
          to: "plus_agent_review_outcome"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_archive_contact: {
        Args: {
          p_contact_id: string
          p_expected_updated_at: string
          p_organization_id: string
          p_reason: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_contact_write_result"]
        SetofOptions: {
          from: "*"
          to: "plus_contact_write_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_can_read: { Args: { p_organization_id: string }; Returns: boolean }
      plus_can_write: { Args: { p_organization_id: string }; Returns: boolean }
      plus_cancel_task: {
        Args: {
          p_expected_updated_at: string
          p_organization_id: string
          p_task_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_task_write_result"]
        SetofOptions: {
          from: "*"
          to: "plus_task_write_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_change_opportunity_stage: {
        Args: {
          p_expected_updated_at: string
          p_note: string
          p_opportunity_id: string
          p_organization_id: string
          p_to_stage: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_opportunity_write_result"]
        SetofOptions: {
          from: "*"
          to: "plus_opportunity_write_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_complete_task: {
        Args: {
          p_expected_updated_at: string
          p_organization_id: string
          p_task_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_task_write_result"]
        SetofOptions: {
          from: "*"
          to: "plus_task_write_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_convert_opportunity_to_request: {
        Args: {
          p_additional_notes: string
          p_assistance_notes: string
          p_destination_description: string
          p_expected_updated_at: string
          p_idempotency_key: string
          p_opportunity_id: string
          p_organization_id: string
          p_pickup_description: string
          p_preferred_date: string
          p_preferred_time: string
          p_requester_relationship: string
          p_return_trip_needed: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_booking_request_result"]
        SetofOptions: {
          from: "*"
          to: "plus_booking_request_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_create_contact: {
        Args: {
          p_confirm_possible_duplicate: boolean
          p_contact_kind: string
          p_display_name: string
          p_do_not_contact: boolean
          p_email: string
          p_job_title: string
          p_organization_id: string
          p_owner_membership_id: string
          p_phone: string
          p_preferred_channel: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_contact_write_result"]
        SetofOptions: {
          from: "*"
          to: "plus_contact_write_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_create_opportunity: {
        Args: {
          p_campaign_code: string
          p_contact_id: string
          p_estimated_value_cents: number
          p_inquiry_type: string
          p_organization_id: string
          p_owner_membership_id: string
          p_service_type: string
          p_source: string
          p_source_detail: string
          p_title: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_opportunity_write_result"]
        SetofOptions: {
          from: "*"
          to: "plus_opportunity_write_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_create_rebooking_request: {
        Args: {
          p_additional_notes: string
          p_assistance_notes: string
          p_contact_id: string
          p_destination_description: string
          p_idempotency_key: string
          p_organization_id: string
          p_pickup_description: string
          p_preferred_date: string
          p_preferred_time: string
          p_requester_relationship: string
          p_return_trip_needed: string
          p_service_type?: string
          p_source: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_booking_request_result"]
        SetofOptions: {
          from: "*"
          to: "plus_booking_request_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_create_task: {
        Args: {
          p_assignee_membership_id: string
          p_contact_id: string
          p_due_at: string
          p_opportunity_id: string
          p_organization_id: string
          p_title: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_task_write_result"]
        SetofOptions: {
          from: "*"
          to: "plus_task_write_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_dismiss_agent_recommendation: {
        Args: {
          p_expected_updated_at: string
          p_organization_id: string
          p_outcome: string
          p_recommendation_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_agent_review_outcome"]
        SetofOptions: {
          from: "*"
          to: "plus_agent_review_outcome"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_find_contact_matches: {
        Args: {
          p_display_name: string
          p_email: string
          p_exclude_contact_id: string
          p_organization_id: string
          p_phone: string
        }
        Returns: {
          contact_id: string
          display_name: string
          match_on: string
          status: string
        }[]
      }
      plus_get_contact: {
        Args: { p_contact_id: string; p_organization_id: string }
        Returns: {
          contact_id: string
          contact_kind: string
          created_at: string
          created_by_name: string
          display_name: string
          do_not_contact: boolean
          email: string
          job_title: string
          owner_can_write: boolean
          owner_membership_id: string
          owner_name: string
          phone: string
          preferred_channel: string
          status: string
          updated_at: string
        }[]
      }
      plus_get_opportunity: {
        Args: { p_opportunity_id: string; p_organization_id: string }
        Returns: {
          campaign_code: string
          channel: string
          closed_at: string
          contact_do_not_contact: boolean
          contact_id: string
          contact_name: string
          contact_status: string
          created_at: string
          created_by_name: string
          estimated_value_cents: number
          inquiry_type: string
          lost_note: string
          lost_reason: string
          opportunity_id: string
          owner_can_write: boolean
          owner_membership_id: string
          owner_name: string
          payment_reported_status: string
          service_type: string
          source: string
          source_detail: string
          stage: string
          title: string
          updated_at: string
        }[]
      }
      plus_get_request_attribution: {
        Args: { p_organization_id: string; p_request_id: string }
        Returns: {
          contact_id: string
          contact_name: string
          contact_status: string
          link_method: string
          linked_at: string
          linked_by_name: string
          opportunity_id: string
          opportunity_stage: string
          opportunity_title: string
          request_id: string
          updated_at: string
        }[]
      }
      plus_get_request_summaries: {
        Args: { p_organization_id: string; p_request_ids: string[] }
        Returns: {
          arrangement_count: number
          arrangement_status: string
          created_at: string
          decision_reason_code: string
          first_completed_at: string
          passenger_linked: boolean
          preferred_date: string
          request_id: string
          service_type: string
          source: string
          state: string
          trips_cancelled: number
          trips_completed: number
          trips_total: number
        }[]
      }
      plus_get_task: {
        Args: { p_organization_id: string; p_task_id: string }
        Returns: {
          assignee_can_write: boolean
          assignee_membership_id: string
          assignee_name: string
          completed_at: string
          completed_by_name: string
          contact_id: string
          contact_name: string
          created_at: string
          created_by_name: string
          due_at: string
          is_overdue: boolean
          opportunity_id: string
          opportunity_stage: string
          opportunity_title: string
          status: string
          task_id: string
          title: string
          updated_at: string
        }[]
      }
      plus_grant_member_access: {
        Args: {
          p_access: string
          p_expected_grant_id: string
          p_membership_id: string
          p_organization_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_member_access_result"]
        SetofOptions: {
          from: "*"
          to: "plus_member_access_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_growth_dashboard: {
        Args: { p_organization_id: string }
        Returns: {
          active_contacts: number
          active_opportunities: number
          attention_opportunities: number
          due_today_tasks: number
          my_open_tasks: number
          open_tasks: number
          overdue_tasks: number
          pending_recommendations: number
          stage_contacted: number
          stage_new_inquiry: number
          stage_qualified: number
          stage_quote_accepted: number
          stage_quote_sent: number
        }[]
      }
      plus_link_request: {
        Args: {
          p_contact_id: string
          p_opportunity_id: string
          p_organization_id: string
          p_request_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_request_attribution_result"]
        SetofOptions: {
          from: "*"
          to: "plus_request_attribution_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_list_agent_recommendations: {
        Args: {
          p_limit: number
          p_offset: number
          p_organization_id: string
          p_view: string
        }
        Returns: {
          approved_task_id: string
          contact_do_not_contact: boolean
          contact_has_email: boolean
          contact_has_phone: boolean
          contact_id: string
          contact_name: string
          contact_preferred_channel: string
          created_at: string
          generated_by_name: string
          last_activity_at: string
          last_activity_type: string
          opportunity_id: string
          opportunity_stage: string
          opportunity_title: string
          proposed_action: string
          recommendation_id: string
          recommendation_type: string
          reviewed_at: string
          reviewed_by_name: string
          signal_days: number
          status: string
          total_count: number
          updated_at: string
        }[]
      }
      plus_list_attention_opportunities: {
        Args: { p_limit: number; p_organization_id: string }
        Returns: {
          attention_type: string
          contact_name: string
          last_activity_at: string
          opportunity_id: string
          opportunity_stage: string
          opportunity_title: string
          signal_days: number
        }[]
      }
      plus_list_contact_activities: {
        Args: {
          p_contact_id: string
          p_limit: number
          p_offset: number
          p_organization_id: string
        }
        Returns: {
          activity_id: string
          activity_type: string
          actor_name: string
          body: string
          occurred_at: string
          recorded_at: string
          total_count: number
        }[]
      }
      plus_list_contact_owner_options: {
        Args: { p_organization_id: string }
        Returns: {
          display_name: string
          is_self: boolean
          membership_id: string
        }[]
      }
      plus_list_contacts: {
        Args: {
          p_contact_kind: string
          p_limit: number
          p_offset: number
          p_organization_id: string
          p_search: string
          p_status: string
        }
        Returns: {
          contact_id: string
          contact_kind: string
          display_name: string
          do_not_contact: boolean
          email: string
          job_title: string
          owner_name: string
          phone: string
          preferred_channel: string
          status: string
          total_count: number
          updated_at: string
        }[]
      }
      plus_list_member_access: {
        Args: { p_organization_id: string }
        Returns: {
          access: string
          display_name: string
          email: string
          grant_id: string
          granted_at: string
          is_self: boolean
          membership_id: string
          role: string
          status: string
        }[]
      }
      plus_list_opportunities: {
        Args: {
          p_contact_id: string
          p_limit: number
          p_offset: number
          p_organization_id: string
          p_owner_membership_id: string
          p_search: string
          p_source: string
          p_stage: string
          p_view: string
        }
        Returns: {
          closed_at: string
          contact_do_not_contact: boolean
          contact_id: string
          contact_name: string
          contact_status: string
          estimated_value_cents: number
          inquiry_type: string
          opportunity_id: string
          owner_name: string
          service_type: string
          source: string
          stage: string
          title: string
          total_count: number
          updated_at: string
        }[]
      }
      plus_list_opportunity_activities: {
        Args: {
          p_limit: number
          p_offset: number
          p_opportunity_id: string
          p_organization_id: string
        }
        Returns: {
          activity_id: string
          activity_type: string
          actor_name: string
          body: string
          from_stage: string
          occurred_at: string
          recorded_at: string
          to_stage: string
          total_count: number
        }[]
      }
      plus_list_recent_activities: {
        Args: { p_limit: number; p_organization_id: string }
        Returns: {
          activity_id: string
          activity_type: string
          actor_name: string
          contact_id: string
          contact_name: string
          from_stage: string
          occurred_at: string
          opportunity_id: string
          opportunity_title: string
          to_stage: string
        }[]
      }
      plus_list_request_attributions: {
        Args: {
          p_contact_id: string
          p_limit: number
          p_offset: number
          p_opportunity_id: string
          p_organization_id: string
        }
        Returns: {
          contact_id: string
          link_method: string
          linked_at: string
          opportunity_id: string
          opportunity_title: string
          request_id: string
          total_count: number
        }[]
      }
      plus_list_tasks: {
        Args: {
          p_assignee_membership_id: string
          p_contact_id: string
          p_limit: number
          p_offset: number
          p_opportunity_id: string
          p_organization_id: string
          p_search: string
          p_view: string
        }
        Returns: {
          assignee_is_self: boolean
          assignee_membership_id: string
          assignee_name: string
          completed_at: string
          completed_by_name: string
          contact_id: string
          contact_name: string
          due_at: string
          is_due_today: boolean
          is_overdue: boolean
          opportunity_id: string
          opportunity_title: string
          status: string
          task_id: string
          title: string
          total_count: number
          updated_at: string
        }[]
      }
      plus_log_contact_activity: {
        Args: {
          p_activity_type: string
          p_body: string
          p_contact_id: string
          p_occurred_at: string
          p_organization_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_activity_write_result"]
        SetofOptions: {
          from: "*"
          to: "plus_activity_write_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_mark_opportunity_lost: {
        Args: {
          p_expected_updated_at: string
          p_lost_note: string
          p_lost_reason: string
          p_opportunity_id: string
          p_organization_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_opportunity_write_result"]
        SetofOptions: {
          from: "*"
          to: "plus_opportunity_write_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_reassign_task: {
        Args: {
          p_assignee_membership_id: string
          p_expected_updated_at: string
          p_organization_id: string
          p_task_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_task_write_result"]
        SetofOptions: {
          from: "*"
          to: "plus_task_write_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_reopen_opportunity: {
        Args: {
          p_expected_updated_at: string
          p_opportunity_id: string
          p_organization_id: string
          p_reason: string
          p_to_stage: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_opportunity_write_result"]
        SetofOptions: {
          from: "*"
          to: "plus_opportunity_write_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_revoke_member_access: {
        Args: {
          p_expected_grant_id: string
          p_membership_id: string
          p_organization_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_member_access_result"]
        SetofOptions: {
          from: "*"
          to: "plus_member_access_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_run_growth_agent_review: {
        Args: { p_organization_id: string }
        Returns: Database["public"]["CompositeTypes"]["plus_agent_review_result"]
        SetofOptions: {
          from: "*"
          to: "plus_agent_review_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_update_contact: {
        Args: {
          p_contact_id: string
          p_contact_kind: string
          p_display_name: string
          p_do_not_contact: boolean
          p_email: string
          p_expected_updated_at: string
          p_job_title: string
          p_organization_id: string
          p_owner_membership_id: string
          p_phone: string
          p_preferred_channel: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_contact_write_result"]
        SetofOptions: {
          from: "*"
          to: "plus_contact_write_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_update_opportunity: {
        Args: {
          p_campaign_code: string
          p_contact_id: string
          p_estimated_value_cents: number
          p_expected_updated_at: string
          p_inquiry_type: string
          p_opportunity_id: string
          p_organization_id: string
          p_owner_membership_id: string
          p_payment_reported_status: string
          p_service_type: string
          p_source: string
          p_source_detail: string
          p_title: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_opportunity_write_result"]
        SetofOptions: {
          from: "*"
          to: "plus_opportunity_write_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_update_request_attribution: {
        Args: {
          p_contact_id: string
          p_expected_updated_at: string
          p_opportunity_id: string
          p_organization_id: string
          p_reason: string
          p_request_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_request_attribution_result"]
        SetofOptions: {
          from: "*"
          to: "plus_request_attribution_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plus_update_task: {
        Args: {
          p_assignee_membership_id: string
          p_due_at: string
          p_expected_updated_at: string
          p_organization_id: string
          p_task_id: string
          p_title: string
        }
        Returns: Database["public"]["CompositeTypes"]["plus_task_write_result"]
        SetofOptions: {
          from: "*"
          to: "plus_task_write_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      publish_website_request_form: {
        Args: { p_organization_id: string }
        Returns: Database["public"]["CompositeTypes"]["website_request_form_publish_result"]
        SetofOptions: {
          from: "*"
          to: "website_request_form_publish_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reassign_trip: {
        Args: {
          p_driver_id: string
          p_expected_assignment_id?: string
          p_reason?: string
          p_trip_id: string
          p_vehicle_id?: string
        }
        Returns: Database["public"]["CompositeTypes"]["trip_assignment_result"]
        SetofOptions: {
          from: "*"
          to: "trip_assignment_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_no_show: {
        Args: { p_reason: string; p_trip_id: string }
        Returns: Database["public"]["CompositeTypes"]["trip_transition_result"]
        SetofOptions: {
          from: "*"
          to: "trip_transition_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_trip_completion_by_operations: {
        Args: {
          p_completed_at: string
          p_expected_current_state: string
          p_note: string
          p_trip_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["trip_transition_result"]
        SetofOptions: {
          from: "*"
          to: "trip_transition_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      redeem_driver_invite: {
        Args: { p_token: string }
        Returns: Database["public"]["CompositeTypes"]["driver_invite_redemption_result"]
        SetofOptions: {
          from: "*"
          to: "driver_invite_redemption_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      report_trip_exception: {
        Args: {
          p_description?: string
          p_exception_type?: string
          p_trip_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["trip_exception_result"]
        SetofOptions: {
          from: "*"
          to: "trip_exception_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resend_staff_invite: {
        Args: { p_invite_id: string }
        Returns: Database["public"]["CompositeTypes"]["staff_invite_result"]
        SetofOptions: {
          from: "*"
          to: "staff_invite_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_trip_exception: {
        Args: { p_exception_id: string; p_resolution_note?: string }
        Returns: Database["public"]["CompositeTypes"]["trip_exception_result"]
        SetofOptions: {
          from: "*"
          to: "trip_exception_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resume_recurring_arrangement: {
        Args: { p_arrangement_id: string; p_organization_id: string }
        Returns: Database["public"]["CompositeTypes"]["recurring_arrangement_result"]
        SetofOptions: {
          from: "*"
          to: "recurring_arrangement_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      retire_request_intake_integration: {
        Args: { p_integration_id: string }
        Returns: Database["public"]["CompositeTypes"]["website_connection_lifecycle_result"]
        SetofOptions: {
          from: "*"
          to: "website_connection_lifecycle_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_driver_invite: { Args: { p_invite_id: string }; Returns: boolean }
      save_driver_unavailability: {
        Args: {
          p_driver_id: string
          p_ends_at: string
          p_starts_at: string
          p_window_id?: string
        }
        Returns: Database["public"]["CompositeTypes"]["unavailability_window_result"]
        SetofOptions: {
          from: "*"
          to: "unavailability_window_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_vehicle_unavailability: {
        Args: {
          p_ends_at: string
          p_starts_at: string
          p_vehicle_id: string
          p_window_id?: string
        }
        Returns: Database["public"]["CompositeTypes"]["unavailability_window_result"]
        SetofOptions: {
          from: "*"
          to: "unavailability_window_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_website_request_form: {
        Args: {
          p_allow_recurring: boolean
          p_confirmation_message: string
          p_intro_text?: string
          p_offered_service_types?: string[]
          p_organization_id: string
          p_require_service_choice: boolean
          p_status: string
          p_submit_label: string
          p_title: string
        }
        Returns: Database["public"]["CompositeTypes"]["website_request_form_save_result"]
        SetofOptions: {
          from: "*"
          to: "website_request_form_save_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_driver_weekly_schedule: {
        Args: { p_driver_id: string; p_shifts: Json }
        Returns: Database["public"]["CompositeTypes"]["driver_schedule_result"]
        SetofOptions: {
          from: "*"
          to: "driver_schedule_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_membership_status: {
        Args: { p_active: boolean; p_membership_id: string }
        Returns: Database["public"]["CompositeTypes"]["membership_change_result"]
        SetofOptions: {
          from: "*"
          to: "membership_change_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_notification_settings: {
        Args: {
          p_event_type: string
          p_organization_id: string
          p_recipient_roles: string[]
        }
        Returns: Database["public"]["CompositeTypes"]["notification_settings_result"]
        SetofOptions: {
          from: "*"
          to: "notification_settings_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_organization_service_offerings: {
        Args: { p_organization_id: string; p_service_types: string[] }
        Returns: Database["public"]["CompositeTypes"]["organization_service_offerings_result"]
        SetofOptions: {
          from: "*"
          to: "organization_service_offerings_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_platform_organization_status: {
        Args: { p_organization_id: string; p_reason: string; p_status: string }
        Returns: Database["public"]["CompositeTypes"]["platform_organization_status_result"]
        SetofOptions: {
          from: "*"
          to: "platform_organization_status_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_recurring_wheelchair_requirement: {
        Args: {
          p_arrangement_id: string
          p_organization_id: string
          p_requires_wheelchair_access: boolean
        }
        Returns: Database["public"]["CompositeTypes"]["wheelchair_requirement_result"]
        SetofOptions: {
          from: "*"
          to: "wheelchair_requirement_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_request_intake_integration_active: {
        Args: { p_active: boolean; p_integration_id: string }
        Returns: Database["public"]["CompositeTypes"]["request_intake_integration_result"]
        SetofOptions: {
          from: "*"
          to: "request_intake_integration_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_request_intake_integration_setup: {
        Args: {
          p_connection_method?: string
          p_integration_id: string
          p_website_manager?: string
        }
        Returns: boolean
      }
      set_trip_expected_duration: {
        Args: { p_expected_duration_minutes: number; p_trip_id: string }
        Returns: Database["public"]["CompositeTypes"]["trip_expected_duration_result"]
        SetofOptions: {
          from: "*"
          to: "trip_expected_duration_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_trip_wheelchair_requirement: {
        Args: { p_requires_wheelchair_access: boolean; p_trip_id: string }
        Returns: Database["public"]["CompositeTypes"]["wheelchair_requirement_result"]
        SetofOptions: {
          from: "*"
          to: "wheelchair_requirement_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_vehicle_capabilities: {
        Args: {
          p_seated_capacity: number
          p_vehicle_id: string
          p_wheelchair_lift: boolean
          p_wheelchair_positions: number
          p_wheelchair_ramp: boolean
        }
        Returns: Database["public"]["CompositeTypes"]["vehicle_capabilities_result"]
        SetofOptions: {
          from: "*"
          to: "vehicle_capabilities_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      signup_create_organization: {
        Args: {
          p_business_name: string
          p_business_stage?: string
          p_display_name: string
          p_timezone?: string
        }
        Returns: Database["public"]["CompositeTypes"]["organization_signup_result"]
        SetofOptions: {
          from: "*"
          to: "organization_signup_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      skip_recurring_occurrence: {
        Args: {
          p_arrangement_id: string
          p_organization_id: string
          p_reason: string
          p_service_date: string
        }
        Returns: Database["public"]["CompositeTypes"]["recurring_occurrence_exception_result"]
        SetofOptions: {
          from: "*"
          to: "recurring_occurrence_exception_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_public_form_request: {
        Args: {
          p_acquisition?: Json
          p_additional_notes?: string
          p_assistance_notes?: string
          p_destination_description: string
          p_idempotency_key: string
          p_pickup_description: string
          p_preferred_date?: string
          p_preferred_time?: string
          p_public_key: string
          p_recurring_appointment_time?: string
          p_recurring_days_of_week?: string[]
          p_recurring_end_date?: string
          p_recurring_return_trip_expected?: boolean
          p_recurring_start_date?: string
          p_requested_passenger_name?: string
          p_requester_email?: string
          p_requester_name: string
          p_requester_phone: string
          p_requester_relationship: string
          p_return_trip_needed: string
          p_service_type?: string
        }
        Returns: Database["public"]["CompositeTypes"]["public_request_submission_result"]
        SetofOptions: {
          from: "*"
          to: "public_request_submission_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_public_transportation_request: {
        Args: {
          p_acquisition?: Json
          p_additional_notes?: string
          p_assistance_notes?: string
          p_destination_description: string
          p_idempotency_key: string
          p_integration_external_id: string
          p_origin?: string
          p_pickup_description: string
          p_preferred_date?: string
          p_preferred_time?: string
          p_recurring_appointment_time?: string
          p_recurring_days_of_week?: string[]
          p_recurring_end_date?: string
          p_recurring_return_trip_expected?: boolean
          p_recurring_start_date?: string
          p_requested_passenger_name?: string
          p_requester_email?: string
          p_requester_name: string
          p_requester_phone: string
          p_requester_relationship: string
          p_return_trip_needed: string
          p_service_type?: string
        }
        Returns: Database["public"]["CompositeTypes"]["public_request_submission_result"]
        SetofOptions: {
          from: "*"
          to: "public_request_submission_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      unskip_recurring_occurrence: {
        Args: {
          p_arrangement_id: string
          p_organization_id: string
          p_service_date: string
        }
        Returns: Database["public"]["CompositeTypes"]["recurring_occurrence_exception_result"]
        SetofOptions: {
          from: "*"
          to: "recurring_occurrence_exception_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_organization_operating_schedule: {
        Args: {
          p_closes_at: string
          p_days: number[]
          p_opens_at: string
          p_organization_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["organization_operating_schedule_result"]
        SetofOptions: {
          from: "*"
          to: "organization_operating_schedule_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_organization_settings: {
        Args: { p_changes: Json; p_organization_id: string }
        Returns: Database["public"]["CompositeTypes"]["organization_settings_result"]
        SetofOptions: {
          from: "*"
          to: "organization_settings_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_organization_trip_defaults: {
        Args: {
          p_default_trip_duration_minutes: number
          p_organization_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["organization_trip_defaults_result"]
        SetofOptions: {
          from: "*"
          to: "organization_trip_defaults_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_request_intake_integration_origin: {
        Args: { p_integration_id: string; p_origin: string }
        Returns: Database["public"]["CompositeTypes"]["request_intake_integration_result"]
        SetofOptions: {
          from: "*"
          to: "request_intake_integration_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_trip_details: {
        Args: {
          p_appointment_at: string
          p_assistance_notes: string
          p_destination_description: string
          p_destination_facility_id: string
          p_expected_updated_at: string
          p_instructions: string
          p_pickup_description: string
          p_pickup_facility_id: string
          p_scheduled_pickup_at: string
          p_trip_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["trip_details_update_result"]
        SetofOptions: {
          from: "*"
          to: "trip_details_update_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      driver_active_trip_summary: {
        trip_id: string | null
        assignment_id: string | null
        state: string | null
        scheduled_pickup_at: string | null
        appointment_at: string | null
        pickup_description: string | null
        destination_description: string | null
        passenger_display_name: string | null
        vehicle_label: string | null
        vehicle_status: string | null
      }
      driver_invite_preview: {
        organization_name: string | null
        display_name: string | null
        email: string | null
        status: string | null
      }
      driver_invite_redemption_result: {
        driver_id: string | null
        organization_id: string | null
        membership_created: boolean | null
        driver_linked: boolean | null
      }
      driver_invite_result: {
        invite_id: string | null
        token: string | null
        email: string | null
        status: string | null
        reused: boolean | null
      }
      driver_location_result: {
        location_id: string | null
        trip_id: string | null
        assignment_id: string | null
        recorded_at: string | null
      }
      driver_own_schedule_result: {
        driver_id: string | null
        organization_id: string | null
        timezone: string | null
        configured: boolean | null
        shifts: Json | null
        upcoming_unavailability: Json | null
      }
      driver_profile_result: {
        driver_id: string | null
        organization_id: string | null
        organization_name: string | null
        display_name: string | null
        phone: string | null
        status: string | null
      }
      driver_schedule_result: {
        driver_id: string | null
        organization_id: string | null
        configured: boolean | null
        shift_count: number | null
        changed: boolean | null
      }
      driver_trip_detail_result: {
        trip_id: string | null
        assignment_id: string | null
        state: string | null
        scheduled_pickup_at: string | null
        appointment_at: string | null
        pickup_description: string | null
        destination_description: string | null
        passenger_display_name: string | null
        passenger_phone: string | null
        assistance_notes: string | null
        instructions: string | null
        vehicle_label: string | null
        vehicle_status: string | null
        driver_notes: Json | null
      }
      driver_trip_history_entry: {
        trip_id: string | null
        scheduled_pickup_at: string | null
        assignment_started_at: string | null
        assignment_ended_at: string | null
        end_reason: string | null
        trip_outcome: string | null
      }
      membership_change_result: {
        membership_id: string | null
        role: string | null
        status: string | null
        changed: boolean | null
      }
      notification_settings_result: {
        changed: boolean | null
      }
      organization_operating_schedule_result: {
        organization_id: string | null
        changed: boolean | null
      }
      organization_service_offerings_result: {
        organization_id: string | null
        first_configuration: boolean | null
        changed: boolean | null
      }
      organization_settings_result: {
        organization_id: string | null
        changed: boolean | null
      }
      organization_signup_result: {
        organization_id: string | null
        membership_id: string | null
        role: string | null
        created: boolean | null
      }
      organization_trip_defaults_result: {
        organization_id: string | null
        default_trip_duration_minutes: number | null
        changed: boolean | null
      }
      owner_driver_link_result: {
        driver_id: string | null
        organization_id: string | null
        linked: boolean | null
      }
      platform_organization_module_result: {
        organization_id: string | null
        module: string | null
        status: string | null
        restriction: string | null
        trial_ends_at: string | null
        trial_extension_count: number | null
        access_ends_at: string | null
        effective_state: string | null
        changed: boolean | null
      }
      platform_organization_module_state: {
        organization_id: string | null
        module: string | null
        provisioned: boolean | null
        status: string | null
        restriction: string | null
        trial_started_at: string | null
        trial_ends_at: string | null
        trial_extension_count: number | null
        access_ends_at: string | null
        effective_state: string | null
        status_reason: string | null
        updated_at: string | null
      }
      platform_organization_status_result: {
        organization_id: string | null
        status: string | null
        changed: boolean | null
      }
      plus_access_state_result: {
        state: string | null
        trial_ends_at: string | null
        access: string | null
      }
      plus_activity_write_result: {
        activity_id: string | null
        changed: boolean | null
      }
      plus_agent_review_outcome: {
        recommendation_id: string | null
        outcome: string | null
        task_id: string | null
        changed: boolean | null
      }
      plus_agent_review_result: {
        created: number | null
        superseded: number | null
        unchanged: number | null
      }
      plus_booking_request_result: {
        request_id: string | null
        contact_id: string | null
        opportunity_id: string | null
        request_state: string | null
        changed: boolean | null
      }
      plus_contact_write_result: {
        contact_id: string | null
        updated_at: string | null
        changed: boolean | null
        possible_duplicates: number | null
      }
      plus_member_access_result: {
        membership_id: string | null
        access: string | null
        grant_id: string | null
        changed: boolean | null
      }
      plus_opportunity_write_result: {
        opportunity_id: string | null
        stage: string | null
        updated_at: string | null
        changed: boolean | null
      }
      plus_request_attribution_result: {
        request_id: string | null
        contact_id: string | null
        opportunity_id: string | null
        updated_at: string | null
        changed: boolean | null
      }
      plus_task_write_result: {
        task_id: string | null
        status: string | null
        updated_at: string | null
        changed: boolean | null
      }
      public_request_submission_result: {
        accepted: boolean | null
        notification_event_id: string | null
      }
      rate_limit_check_result: {
        allowed: boolean | null
      }
      recurring_arrangement_result: {
        arrangement_id: string | null
        organization_id: string | null
        passenger_id: string | null
        pickup_description: string | null
        destination_description: string | null
        pickup_time: string | null
        days_of_week: number[] | null
        start_date: string | null
        end_date: string | null
        timezone: string | null
        status: string | null
        paused_at: string | null
        ended_at: string | null
        ended_reason: string | null
        created_by: string | null
        created_at: string | null
        changed: boolean | null
      }
      recurring_occurrence_exception_result: {
        exception_id: string | null
        arrangement_id: string | null
        organization_id: string | null
        service_date: string | null
        reason: string | null
        created_by: string | null
        created_at: string | null
        changed: boolean | null
      }
      request_creation_result: {
        request_id: string | null
        organization_id: string | null
        state: string | null
        created: boolean | null
      }
      request_intake_integration_result: {
        integration_id: string | null
        external_id: string | null
        is_active: boolean | null
        changed: boolean | null
        deactivated: boolean | null
      }
      request_passenger_link_result: {
        request_id: string | null
        organization_id: string | null
        passenger_id: string | null
        changed: boolean | null
      }
      request_transition_result: {
        request_id: string | null
        organization_id: string | null
        previous_state: string | null
        current_state: string | null
        changed: boolean | null
      }
      staff_invite_acceptance_result: {
        organization_id: string | null
        role: string | null
        membership_created: boolean | null
        membership_reactivated: boolean | null
      }
      staff_invite_preview: {
        organization_name: string | null
        email: string | null
        role: string | null
        status: string | null
      }
      staff_invite_result: {
        invite_id: string | null
        token: string | null
        email: string | null
        role: string | null
        expires_at: string | null
        reissued: boolean | null
      }
      trip_assignment_result: {
        trip_id: string | null
        assignment_id: string | null
        driver_id: string | null
        vehicle_id: string | null
        changed: boolean | null
      }
      trip_creation_result: {
        trip_id: string | null
        organization_id: string | null
        state: string | null
        created: boolean | null
      }
      trip_details_update_result: {
        trip_id: string | null
        changed: boolean | null
        changed_fields: string[] | null
        updated_at: string | null
      }
      trip_exception_result: {
        exception_id: string | null
        trip_id: string | null
        organization_id: string | null
        exception_type: string | null
        description: string | null
        status: string | null
        created_by: string | null
        resolved_by: string | null
        resolved_at: string | null
        resolution_note: string | null
        created_at: string | null
        changed: boolean | null
        notification_event_id: string | null
      }
      trip_expected_duration_result: {
        trip_id: string | null
        expected_duration_minutes: number | null
        expected_duration_source: string | null
        changed: boolean | null
      }
      trip_transition_result: {
        trip_id: string | null
        previous_state: string | null
        current_state: string | null
        changed: boolean | null
      }
      unavailability_window_result: {
        window_id: string | null
        resource_id: string | null
        organization_id: string | null
        starts_at: string | null
        ends_at: string | null
        deleted: boolean | null
        changed: boolean | null
      }
      vehicle_capabilities_result: {
        vehicle_id: string | null
        wheelchair_ramp: boolean | null
        wheelchair_lift: boolean | null
        wheelchair_positions: number | null
        seated_capacity: number | null
        changed: boolean | null
      }
      website_connection_lifecycle_result: {
        integration_id: string | null
        external_id: string | null
        changed: boolean | null
      }
      website_request_form_publication_state: {
        public_key: string | null
        publication_status: string | null
        published_version: number | null
        published_at: string | null
        request_count: number | null
        last_request_received_at: string | null
      }
      website_request_form_publish_result: {
        public_key: string | null
        publication_status: string | null
        published_version: number | null
        changed: boolean | null
      }
      website_request_form_save_result: {
        form_version: number | null
        status: string | null
        changed: boolean | null
      }
      wheelchair_requirement_result: {
        entity_id: string | null
        requires_wheelchair_access: boolean | null
        changed: boolean | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

