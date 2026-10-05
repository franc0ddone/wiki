-- Append-only publish history.
--
-- `article_versions` records what was live at each publish. The API exposes no
-- update or delete path for it; these triggers make that a database guarantee
-- rather than a convention, so no future endpoint, script, or hand-run SQL can
-- quietly rewrite a published version.
--
-- If a retention/purge policy is ever introduced, `ALTER TABLE
-- article_versions DISABLE TRIGGER article_versions_no_delete;` is the
-- deliberate, reviewable step to take — do not drop the function silently.

CREATE OR REPLACE FUNCTION article_versions_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'article_versions is append-only (attempted % on row %)',
    TG_OP, COALESCE(OLD.id::text, 'unknown')
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER article_versions_no_update
  BEFORE UPDATE ON article_versions
  FOR EACH ROW EXECUTE FUNCTION article_versions_immutable();

CREATE TRIGGER article_versions_no_delete
  BEFORE DELETE ON article_versions
  FOR EACH ROW EXECUTE FUNCTION article_versions_immutable();
