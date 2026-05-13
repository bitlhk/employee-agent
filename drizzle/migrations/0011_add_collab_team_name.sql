ALTER TABLE lx_collab_user_profiles
  ADD COLUMN team_name varchar(200) NULL AFTER department_name;

CREATE INDEX idx_lx_collab_user_profiles_team
  ON lx_collab_user_profiles (team_name);
