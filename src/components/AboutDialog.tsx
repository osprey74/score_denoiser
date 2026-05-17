import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

const RELEASES_URL = "https://github.com/osprey74/score_denoiser/releases";
const BSKY_URL = "https://bsky.app/profile/laixiaoxia.bsky.social";
const ICON_URL = "https://www.flaticon.com/free-icons/music-score";
const KOFI_URL = "https://ko-fi.com/A0A71UNW9H";

interface AboutDialogProps {
  onClose: () => void;
}

export function AboutDialog({ onClose }: AboutDialogProps) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("?"));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleLink = (url: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    openUrl(url).catch((err) => {
      console.error("Failed to open URL:", err);
    });
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h2 id="about-title">このアプリについて</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="閉じる"
            title="閉じる (Esc)"
          >
            ✕
          </button>
        </header>

        <div className="modal-body">
          <div className="about-title-block">
            <img src="/music-score.png" alt="" className="about-icon" />
            <div>
              <div className="about-name">Nitido</div>
              <div className="about-version">version {version || "—"}</div>
              <div className="about-sub">楽譜ノイズ除去ツール</div>
            </div>
          </div>

          <dl className="about-grid">
            <dt>リリース</dt>
            <dd>
              <a href={RELEASES_URL} onClick={handleLink(RELEASES_URL)}>
                {RELEASES_URL}
              </a>
            </dd>

            <dt>Special Thanks</dt>
            <dd>
              小霞（かすみ）／{" "}
              <a href={BSKY_URL} onClick={handleLink(BSKY_URL)}>
                @laixiaoxia.bsky.social
              </a>
            </dd>

            <dt>アイコン</dt>
            <dd>
              <a
                href={ICON_URL}
                onClick={handleLink(ICON_URL)}
                title="music-score icons"
              >
                Music-score icons created by Freepik - Flaticon
              </a>
            </dd>
          </dl>

          <section className="about-kofi">
            <p>アプリ作者にコーヒーをご馳走する</p>
            <button
              type="button"
              className="kofi-button"
              onClick={() => openUrl(KOFI_URL).catch(console.error)}
            >
              <img
                src="https://storage.ko-fi.com/cdn/cup-border.png"
                alt=""
                className="kofi-cup"
              />
              Buy the developer a coffee on Ko-fi
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
