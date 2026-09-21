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
          request_id: string
        }
        Insert: {
          actor_user_id?: string | null
          event_type: string
          id?: string
          metadata?: Json
          occurred_at?: string
          organization_id: string
          request_id: string
        }
        Update: {
          actor_user_id?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          organization_id?: string
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
          created_at: string
          external_id: string
          id: string
          integration_type: string
          is_active: boolean
          organization_id: string
          updated_at: string
        }
        Insert: {
          allowed_origins?: string[] | null
          created_at?: string
          external_id: string
          id?: string
          integration_type?: string
          is_active?: boolean
          organization_id: string
          updated_at?: string
        }
        Update: {
          allowed_origins?: string[] | null
          created_at?: string
          external_id?: string
          id?: string
          integration_type?: string
          is_active?: boolean
          organization_id?: string
          updated_at?: string
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
          id: string
          instructions: string | null
          no_show_at: string | null
          organization_id: string
          passenger_id: string
          pickup_description: string
          pickup_facility_id: string | null
          recurring_arrangement_id: string | null
          request_id: string | null
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
          id?: string
          instructions?: string | null
          no_show_at?: string | null
          organization_id: string
          passenger_id: string
          pickup_description: string
          pickup_facility_id?: string | null
          recurring_arrangement_id?: string | null
          request_id?: string | null
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
          id?: string
          instructions?: string | null
          no_show_at?: string | null
          organization_id?: string
          passenger_id?: string
          pickup_description?: string
          pickup_facility_id?: string | null
          recurring_arrangement_id?: string | null
          request_id?: string | null
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
      vehicles: {
        Row: {
          created_at: string
          id: string
          label: string
          organization_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          organization_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          organization_id?: string
          status?: string
          updated_at?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      _require_platform_admin: { Args: never; Returns: undefined }
      _sanitize_acquisition: { Args: { p_acquisition: Json }; Returns: Json }
      _staff_invite_token_hash: { Args: { p_token: string }; Returns: string }
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
        Args: { p_organization_id: string; p_request_id: string }
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
          p_instructions?: string
          p_organization_id: string
          p_passenger_id: string
          p_pickup_description: string
          p_pickup_facility_id?: string
          p_request_id?: string
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
          p_reason?: string
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
      list_request_intake_integrations: {
        Args: { p_organization_id: string }
        Returns: {
          allowed_origins: string[]
          created_at: string
          external_id: string
          id: string
          integration_type: string
          is_active: boolean
          last_request_received_at: string
          request_count: number
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
      revoke_driver_invite: { Args: { p_invite_id: string }; Returns: boolean }
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
      driver_profile_result: {
        driver_id: string | null
        organization_id: string | null
        organization_name: string | null
        display_name: string | null
        phone: string | null
        status: string | null
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
      owner_driver_link_result: {
        driver_id: string | null
        organization_id: string | null
        linked: boolean | null
      }
      platform_organization_status_result: {
        organization_id: string | null
        status: string | null
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
      trip_transition_result: {
        trip_id: string | null
        previous_state: string | null
        current_state: string | null
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

