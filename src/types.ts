export type UserProfile = {
  id: string;
  username: string;
  display_name: string;
  roles: string[];
  permissions: string[];
  accepting_work: boolean;
};

export type Me = {
  session: "full" | "mfa_setup";
  user: UserProfile;
};

export type Staff = {
  id: string;
  username: string;
  display_name: string;
  status: string;
  timezone: string;
  roles: string[];
  mfa_enabled: boolean;
  accepting_work: boolean;
};

export type Role = {
  code: string;
  name: string;
  permissions: string[];
};

export type Draft = {
  username: string;
  display_name: string;
  timezone: string;
  role_codes: string[];
  status: "active" | "disabled";
  password: string;
};

export type UpdateStaffBody = {
  display_name?: string;
  status?: "active" | "disabled";
  timezone?: string;
  role_codes?: string[];
  password?: string;
};

export type CreateStaffBody = {
  username: string;
  display_name: string;
  password: string;
  role_codes: string[];
  timezone: string;
};

export type FieldErrors = Record<string, string>;

export type Shift = {
  id: string;
  timezone: string;
  start_local: string;
  end_local: string;
  break_start_local: string | null;
  break_end_local: string | null;
  effective_from: string;
};

export type Leave = {
  id: string;
  user_id: string;
  kind: "leave" | "absence";
  starts_at: string;
  ends_at: string;
};

export type Page<T> = {
  items: T[];
  next_cursor: string | null;
};

export type VipCustomer = {
  id: string;
  customer_ref: string;
  display_name: string;
  game_account: string | null;
  site: string | null;
  phone_mask: string;
  tier: string | null;
  status: "active" | "disabled";
  care_pool: "active" | "kho_data" | "nuoi_sms";
  owner_user_id: string | null;
  owner_name: string | null;
  created_at: string;
};

export type ImportJob = {
  id: string;
  status: string;
  total_rows: number;
  created_count: number;
  skipped_count: number;
  errors: { row: number; code: string }[];
  errors_truncated: boolean;
  created_at: string;
};

export type AuditEvent = {
  id: string;
  actor_id: string | null;
  actor_username: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  request_id: string | null;
  outcome: string;
  summary: Record<string, unknown>;
  created_at: string;
};

export type SystemLog = {
  id: string;
  level: string;
  event: string;
  message: string;
  request_id: string | null;
  context: Record<string, unknown>;
  created_at: string;
};
