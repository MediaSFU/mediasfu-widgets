import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faClockRotateLeft,
  faMicrophone,
  faMobileScreenButton,
  faPhone,
  faPhoneSlash,
  faShieldHalved,
} from "@fortawesome/free-solid-svg-icons";
import "./CallsPagePreview.css";

const dialpad = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

export default function CallsPagePreview() {
  const params = new URLSearchParams(window.location.search);
  const requestedState = params.get("state") || "empty";
  const previewState = ["empty", "active", "pending", "error", "connected"].includes(requestedState) ? requestedState : "empty";
  const showDialer = previewState === "active";

  return (
    <main className="calls-presentation" data-preview-state={previewState} aria-label="Calls widget visual presentation">
      <header className="calls-presentation__intro">
        <div>
          <span className="calls-presentation__eyebrow">Calls widget</span>
          <h1>Outgoing Call Room</h1>
          <p>Create a voice room for team calling, or place a focused Quick Call.</p>
        </div>
        <span className="calls-presentation__mode">
          <FontAwesomeIcon icon={faShieldHalved} /> Visual preview
        </span>
      </header>

      <section className="calls-presentation__actions" aria-label="Call setup actions">
        <article>
          <span className="calls-presentation__icon"><FontAwesomeIcon icon={faMicrophone} /></span>
          <div><strong>Create Voice Room</strong><small>Manual setup and room controls</small></div>
        </article>
        <article className="is-primary">
          <span className="calls-presentation__icon"><FontAwesomeIcon icon={faMobileScreenButton} /></span>
          <div><strong>Quick Call</strong><small>Dial a number or choose a contact</small></div>
        </article>
        <label>
          <span>Max call duration</span>
          <select value="30" disabled aria-label="Max call duration preview"><option>30 minutes</option></select>
        </label>
      </section>

      <div className={`calls-presentation__workspace ${showDialer ? "has-dialer" : ""}`}>
        {showDialer && (
          <aside className="calls-presentation__dialer" aria-label="Dialer visual preview">
            <div className="calls-presentation__section-heading">
              <div><span>New outbound call</span><h2>Dial a number</h2></div>
              <span className="calls-presentation__status">Ready</span>
            </div>
            <div className="calls-presentation__number">+1 785 369 1724</div>
            <div className="calls-presentation__keypad">
              {dialpad.map((value) => <button key={value} type="button" disabled>{value}</button>)}
            </div>
            <button className="calls-presentation__call" type="button" disabled>
              <FontAwesomeIcon icon={faPhone} /> Start call
            </button>
          </aside>
        )}

        <section className="calls-presentation__activity">
          <div className="calls-presentation__section-heading">
            <div><span>Live workspace</span><h2>Active Calls</h2></div>
            <span className="calls-presentation__status">0 active</span>
          </div>
          <div className="calls-presentation__empty">
            <span className="calls-presentation__empty-icon"><FontAwesomeIcon icon={faPhoneSlash} /></span>
            <h4>No Active Calls</h4>
            <p>{showDialer ? "The dialer is ready for a number." : "Open the dialer or create a voice room to begin."}</p>
          </div>
        </section>
      </div>

      <section className="calls-presentation__history">
        <div>
          <span className="calls-presentation__history-icon"><FontAwesomeIcon icon={faClockRotateLeft} /></span>
          <div><strong>Recent Call History</strong><small>Completed and missed calls appear here for the current session.</small></div>
        </div>
        <span>Session only</span>
      </section>

      <footer>
        Presentation only. Connect a Calls widget key to load account numbers and place calls.
      </footer>
    </main>
  );
}
