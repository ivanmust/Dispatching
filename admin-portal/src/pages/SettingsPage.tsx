import { useEffect, useState } from "react";
import { request, type AdminSettings } from "../api";

export function SettingsPage() {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    request<AdminSettings>("/admin/settings")
      .then((s) => {
        setSettings(s);
        setError("");
      })
      .catch((e) => setError(String(e?.message || e)));
  }, []);

  const update = async (patch: Partial<AdminSettings>) => {
    try {
      setSaving(true);
      const next = await request<AdminSettings>("/admin/settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setSettings(next);
      setError("");
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: keyof AdminSettings) => {
    if (!settings) return;
    void update({ [key]: !settings[key] } as Partial<AdminSettings>);
  };

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <h1 className="pageTitle">Settings</h1>
          <p className="pageSubtitle">Platform-wide configuration for the CAD dispatch stack.</p>
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div className="sectionGrid">
        <div className="card">
          <div className="cardHeaderRow">
            <div>
              <h3 className="cardTitle">Feature flags</h3>
              <p className="cardSub">Turn high-level capabilities on or off.</p>
            </div>
          </div>
          <label className="listRow">
            <span>Allow user self-registration</span>
            <input
              type="checkbox"
              disabled={saving}
              checked={Boolean(settings?.allow_user_registration)}
              onChange={() => toggle("allow_user_registration")}
            />
          </label>
          <label className="listRow">
            <span>Messaging enabled</span>
            <input
              type="checkbox"
              disabled={saving}
              checked={Boolean(settings?.messaging_enabled)}
              onChange={() => toggle("messaging_enabled")}
            />
          </label>
          <label className="listRow">
            <span>Video streaming enabled</span>
            <input
              type="checkbox"
              disabled={saving}
              checked={Boolean(settings?.video_streaming_enabled)}
              onChange={() => toggle("video_streaming_enabled")}
            />
          </label>
          <label className="listRow">
            <span>Maintenance mode</span>
            <input
              type="checkbox"
              disabled={saving}
              checked={Boolean(settings?.maintenance_mode_enabled)}
              onChange={() => toggle("maintenance_mode_enabled")}
            />
          </label>
        </div>
        <div className="card">
          <div className="cardHeaderRow">
            <div>
              <h3 className="cardTitle">Operational notes</h3>
              <p className="cardSub">
                Settings here affect how the dispatcher and responder apps behave. Use with care, ideally during low
                traffic.
              </p>
            </div>
          </div>
          <ul className="muted" style={{ paddingLeft: 16, fontSize: 12, lineHeight: 1.5 }}>
            <li>Maintenance mode blocks non-dispatchers from logging in.</li>
            <li>Messaging and video streaming toggles hide/show capabilities across clients.</li>
            <li>Registration controls whether new accounts can be created by users themselves.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

