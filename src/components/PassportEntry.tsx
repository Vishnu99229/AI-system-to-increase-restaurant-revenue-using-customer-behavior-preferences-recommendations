import { useState, useEffect, useRef } from "react";
import { useApp } from "../contexts/AppContext";
import { getRestaurantConfig } from "../config/restaurants";
import "./PassportEntry.css";

interface PassportEntryProps {
  onViewMenu: () => void;
}

export default function PassportEntry({ onViewMenu }: PassportEntryProps) {
  const { state, dispatch } = useApp();
  const restaurantSlug = state.restaurantId;
  const config = getRestaurantConfig(restaurantSlug);
  const passportConfig = config.passportConfig;

  // localStorage keys (restaurant-prefixed to avoid collisions)
  const visitCountKey = `${restaurantSlug}_visit_count`;
  const visitorNameKey = `${restaurantSlug}_visitor_name`;
  const lastVisitKey = `${restaurantSlug}_last_visit`;

  // Component state
  const [nameValue, setNameValue] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showStamp, setShowStamp] = useState(false);
  const [stampLanded, setStampLanded] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [visitCount, setVisitCount] = useState(1);
  const [isReturning, setIsReturning] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const prefersReducedMotion = useRef(
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  // Hydrate from localStorage on mount
  useEffect(() => {
    const storedName = localStorage.getItem(visitorNameKey);
    const storedCount = localStorage.getItem(visitCountKey);

    if (storedName) {
      setNameValue(storedName);
      setIsReturning(true);
    }

    if (storedCount) {
      const parsed = parseInt(storedCount, 10);
      if (!isNaN(parsed)) {
        setVisitCount(parsed + 1);
      }
    }
  }, [visitorNameKey, visitCountKey]);

  // Derived values
  const trimmedName = nameValue.trim();
  const baseOffset = passportConfig?.visitorBaseOffset ?? 0;
  const visitorNumber = Math.round(baseOffset + visitCount).toLocaleString();

  const today = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date());

  // Stamp color based on visit tier
  const getStampColor = (): string => {
    if (visitCount >= 10) return "#1A1A2E";
    if (visitCount >= 4) return "#1D9E75";
    return "#FF6B35";
  };

  const stampColor = getStampColor();
  const isRegular = visitCount >= 10;
  const stampText = passportConfig?.stampText ?? "VISITED";

  const handleSubmit = () => {
    if (isSubmitting) return;

    const name = nameValue.trim();
    if (name.length < 2 || name.length > 30) {
      setError("Name must be 2 to 30 characters.");
      return;
    }

    setError("");
    setIsSubmitting(true);

    // Persist to localStorage immediately
    localStorage.setItem(visitorNameKey, name);
    localStorage.setItem(visitCountKey, String(visitCount));
    localStorage.setItem(lastVisitKey, new Date().toISOString());

    // Dispatch name to context and navigate (deferred until after animation)
    const dispatchAndNavigate = () => {
      dispatch({ type: "SET_CUSTOMER_NAME", payload: name });
      dispatch({ type: "SET_USER_NAME", payload: name });
      onViewMenu();
    };

    // Reduced motion: skip animations, fade to back then navigate
    if (prefersReducedMotion.current) {
      setShowStamp(true);
      setStampLanded(true);
      setIsFlipped(true);
      setTimeout(dispatchAndNavigate, 800);
      return;
    }

    // Full animation sequence
    // 1. Show stamp (animates from scale(3) to scale(1) over 400ms)
    setShowStamp(true);

    // 2. After stamp lands (400ms): trigger card shake
    setTimeout(() => {
      setStampLanded(true);

      // 3. After shake settles (600ms after stamp): flip card
      setTimeout(() => {
        setIsFlipped(true);

        // 4. After flip completes (700ms) + 400ms delay: navigate
        setTimeout(dispatchAndNavigate, 1100);
      }, 600);
    }, 400);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit();
    }
  };

  return (
    <div className="passport-screen">
      {/* Table number */}
      {state.tableNumber && (
        <div className="passport-table-number">
          Table {state.tableNumber}
        </div>
      )}

      {/* Header */}
      <div className="passport-header">
        <div className="passport-logo" aria-hidden="true">
          ☕
        </div>
        <div className="passport-subtitle">Café Passport</div>
      </div>

      {/* Card container: perspective + shake */}
      <div
        className={`passport-card-container${
          stampLanded ? " passport-shake" : ""
        }`}
      >
        {/* Card: flip transform */}
        <div
          className={`passport-card${
            isFlipped ? " passport-card-flipped" : ""
          }`}
        >
          {/* ── Front Face ── */}
          <div className="passport-card-front">
            <h1 className="passport-card-title">
              Welcome to {config.displayName}
            </h1>

            <div className="passport-input-group">
              <label htmlFor="passport-name-input" className="passport-label">
                Your name
              </label>
              <input
                ref={inputRef}
                id="passport-name-input"
                type="text"
                value={nameValue}
                onChange={(e) => {
                  setNameValue(e.target.value);
                  if (error) setError("");
                }}
                onKeyDown={handleKeyDown}
                disabled={isSubmitting}
                placeholder="e.g. Rahul"
                className={`passport-input${
                  error ? " passport-input-error" : ""
                }`}
                autoComplete="off"
                maxLength={30}
              />
              {error && (
                <div className="passport-error" role="alert">
                  {error}
                </div>
              )}
            </div>

            <p className="passport-helper">
              {isReturning
                ? "Welcome back. Stamp to enter."
                : "Stamp your passport to enter"}
            </p>

            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !trimmedName}
              aria-label={
                isSubmitting ? "Stamping your passport" : "Stamp and enter"
              }
              className="passport-cta"
            >
              {isSubmitting ? "Stamping..." : "Stamp & Enter"}
            </button>
          </div>

          {/* ── Back Face ── */}
          <div className="passport-card-back">
            <div className="passport-back-content">
              <div className="passport-back-name">{trimmedName}</div>
              <div className="passport-back-visitor">
                Visitor #{visitorNumber}
              </div>
              <div className="passport-back-date">{today}</div>
              {isRegular && <div className="passport-badge">REGULAR</div>}
            </div>
          </div>
        </div>

        {/* ── Stamp Overlay ── */}
        {showStamp && (
          <div
            className={`passport-stamp${
              stampLanded ? " passport-stamp-landed" : ""
            }`}
          >
            <svg
              viewBox="0 0 200 200"
              className="passport-stamp-svg"
              aria-hidden="true"
            >
              <defs>
                <path
                  id="stamp-text-outer"
                  d="M 100,100 m -70,0 a 70,70 0 1,1 140,0 a 70,70 0 1,1 -140,0"
                />
                <path
                  id="stamp-text-inner"
                  d="M 100,100 m -45,0 a 45,45 0 1,1 90,0 a 45,45 0 1,1 -90,0"
                />
              </defs>

              {/* Concentric rings */}
              <circle
                cx="100"
                cy="100"
                r="88"
                fill="none"
                stroke={stampColor}
                strokeWidth="3.5"
                opacity="0.85"
              />
              <circle
                cx="100"
                cy="100"
                r="78"
                fill="none"
                stroke={stampColor}
                strokeWidth="1.5"
                opacity="0.5"
              />

              {/* Outer text: stamp text from config */}
              <text
                fill={stampColor}
                fontSize="12.5"
                fontWeight="700"
                letterSpacing="3"
                fontFamily="var(--font-body)"
              >
                <textPath
                  href="#stamp-text-outer"
                  startOffset="50%"
                  textAnchor="middle"
                >
                  {stampText}
                </textPath>
              </text>

              {/* Inner text: date */}
              <text
                fill={stampColor}
                fontSize="11"
                fontWeight="500"
                fontFamily="var(--font-body)"
              >
                <textPath
                  href="#stamp-text-inner"
                  startOffset="50%"
                  textAnchor="middle"
                >
                  {today}
                </textPath>
              </text>

              {/* Center dot */}
              <circle
                cx="100"
                cy="100"
                r="6"
                fill={stampColor}
                opacity="0.25"
              />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
