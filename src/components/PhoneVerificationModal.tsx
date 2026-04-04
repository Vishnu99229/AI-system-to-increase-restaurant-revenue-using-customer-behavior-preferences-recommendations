import { useState, useEffect, useRef } from "react";
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import type { ConfirmationResult } from "firebase/auth";
import { auth, isFirebaseConfigured } from "../lib/firebase";
import { customerLogin } from "../utils/api";

// Extend window to hold the singleton reCAPTCHA verifier
declare global {
    interface Window {
        recaptchaVerifier?: RecaptchaVerifier;
    }
}

interface PhoneVerificationModalProps {
    onVerified: (phone: string) => void;
    onClose: () => void;
}

/**
 * Lazily creates (or reuses) an invisible RecaptchaVerifier.
 * Only called when the user clicks "Send OTP" — never on mount.
 * Attaches to the #recaptcha-container div which must already be in the DOM.
 */
function setupRecaptcha(): RecaptchaVerifier {
    // Guard: auth must be available
    if (!auth) {
        throw new Error("Firebase auth not configured");
    }

    // Reuse existing verifier if it's still alive
    if (window.recaptchaVerifier) {
        console.log("[OTP Debug] Reusing existing RecaptchaVerifier");
        return window.recaptchaVerifier;
    }

    // CHECK 1: Verify container exists in DOM
    const container = document.getElementById("recaptcha-container");
    if (!container) {
        console.error("[OTP Debug] CHECK 1 FAIL: #recaptcha-container missing from DOM");
        throw new Error("recaptcha-container not found in DOM");
    }
    console.log("[OTP Debug] CHECK 1 OK: #recaptcha-container found in DOM");

    window.recaptchaVerifier = new RecaptchaVerifier(auth, container, {
        size: "invisible",
    });

    console.log("[OTP Debug] RecaptchaVerifier created (invisible)");
    return window.recaptchaVerifier;
}

/**
 * Clears the current reCAPTCHA verifier so a fresh one can be created on retry.
 */
function clearRecaptcha(): void {
    if (window.recaptchaVerifier) {
        try {
            window.recaptchaVerifier.clear();
        } catch {
            // ignore cleanup errors
        }
        window.recaptchaVerifier = undefined;
    }
}

export default function PhoneVerificationModal({ onVerified, onClose }: PhoneVerificationModalProps) {
    const [phone, setPhone] = useState("");
    const [otp, setOtp] = useState("");
    const [step, setStep] = useState<"phone" | "otp">("phone");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const otpInputRef = useRef<HTMLInputElement>(null);
    const confirmationResultRef = useRef<ConfirmationResult | null>(null);

    const phoneDigits = phone.replace(/\D/g, "");
    const isPhoneValid = phoneDigits.length >= 10;
    const isOtpValid = otp.replace(/\D/g, "").length === 6;

    // Clean up reCAPTCHA verifier when modal unmounts
    useEffect(() => {
        return () => {
            clearRecaptcha();
        };
    }, []);

    /**
     * Core sign-in attempt. Separated so handleSendOtp can retry once silently.
     */
    const attemptSignIn = async (fullPhone: string): Promise<ConfirmationResult> => {
        if (!auth) {
            throw new Error("Firebase auth not configured");
        }

        // --- Pre-flight diagnostics (CHECK 1–4) ---
        console.log("[OTP Debug] Pre-flight:", {
            "CHECK 1 - container": document.getElementById("recaptcha-container") ? "PRESENT" : "MISSING",
            "CHECK 2 - phone (E.164)": fullPhone,
            "CHECK 3 - projectId": auth.app.options.projectId || "MISSING",
            "CHECK 4 - origin": window.location.origin,
            "CHECK 4 - authDomain": auth.app.options.authDomain || "MISSING",
        });

        const verifier = setupRecaptcha();

        try {
            const result = await signInWithPhoneNumber(auth, fullPhone, verifier);
            console.log("[OTP Debug] signInWithPhoneNumber succeeded — OTP sent to", fullPhone);
            return result;
        } catch (err: any) {
            console.error("[OTP Debug] signInWithPhoneNumber FAILED:", {
                code: err?.code,
                message: err?.message,
                phone: fullPhone,
            });
            throw err;
        }
    };

    const handleSendOtp = async () => {
        if (!isPhoneValid || loading) return;
        setLoading(true);
        setError("");

        const fullPhone = `+91${phoneDigits.slice(-10)}`;

        try {
            // First attempt
            const result = await attemptSignIn(fullPhone);
            confirmationResultRef.current = result;
            setStep("otp");
        } catch (firstErr: any) {
            console.error("[Firebase OTP] First attempt failed:", firstErr?.code || firstErr);

            // --- Silent retry: reset reCAPTCHA and try once more ---
            if (firstErr?.code !== "auth/too-many-requests" && firstErr?.code !== "auth/invalid-phone-number") {
                clearRecaptcha();
                try {
                    const retryResult = await attemptSignIn(fullPhone);
                    confirmationResultRef.current = retryResult;
                    setStep("otp");
                    setLoading(false);
                    return; // retry succeeded — exit early
                } catch (retryErr: any) {
                    console.error("[Firebase OTP] Retry also failed:", retryErr?.code || retryErr);
                    clearRecaptcha();
                    // Fall through to surface the original error
                }
            } else {
                clearRecaptcha();
            }

            // Surface a user-friendly error
            if (firstErr?.code === "auth/too-many-requests") {
                setError("Too many attempts. Please try again later.");
            } else if (firstErr?.code === "auth/invalid-phone-number") {
                setError("Invalid phone number. Please check and try again.");
            } else {
                setError("Failed to send OTP. Please try again.");
            }
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOtp = async () => {
        if (!isOtpValid || loading) return;
        setLoading(true);
        setError("");

        try {
            const fullPhone = `+91${phoneDigits.slice(-10)}`;
            const otpCode = otp.replace(/\D/g, "");

            if (!confirmationResultRef.current) {
                setError("Verification session expired. Please request a new OTP.");
                setStep("phone");
                setLoading(false);
                return;
            }

            // Confirm the OTP with Firebase
            await confirmationResultRef.current.confirm(otpCode);

            // OTP verified — call backend to register/login customer
            const loginResult = await customerLogin(fullPhone);

            if (loginResult.success && loginResult.token) {
                // Cache verification in localStorage for 24 hours
                localStorage.setItem(
                    "orlena_phone_verification",
                    JSON.stringify({
                        phone: fullPhone,
                        verification_token: loginResult.token,
                        verified_at: Date.now(),
                        expires: Date.now() + (loginResult.expires_in || 86400) * 1000,
                    })
                );
                onVerified(fullPhone);
            } else {
                setError(loginResult.error || "Login failed. Please try again.");
            }
        } catch (err: any) {
            console.error("[Firebase OTP] Verify error:", err);
            if (err?.code === "auth/invalid-verification-code") {
                setError("Invalid OTP. Please check and try again.");
            } else if (err?.code === "auth/code-expired") {
                setError("OTP has expired. Please request a new one.");
                setStep("phone");
            } else {
                setError("Verification failed. Please try again.");
            }
        } finally {
            setLoading(false);
        }
    };

    // Focus OTP input when step changes
    useEffect(() => {
        if (step === "otp" && otpInputRef.current) {
            otpInputRef.current.focus();
        }
    }, [step]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-fade-in">
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-heading font-bold text-dark">
                        {step === "phone" ? "Verify Your Phone" : "Enter OTP"}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-dark transition-colors p-1"
                        aria-label="Close"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6L6 18" /><path d="M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Firebase not configured — graceful degradation */}
                {!isFirebaseConfigured ? (
                    <div className="space-y-4">
                        <p className="text-sm text-dark/60">
                            We'll send a one-time code to verify your number.
                        </p>
                        <div>
                            <label className="block text-sm font-medium text-dark/70 mb-1">Phone Number</label>
                            <div className="flex gap-2">
                                <span className="flex items-center px-3 py-3 rounded-lg border border-gray-200 bg-gray-50 text-gray-400 text-base font-medium">
                                    +91
                                </span>
                                <input
                                    type="tel"
                                    placeholder="9876543210"
                                    disabled
                                    className="flex-1 px-4 py-3 rounded-lg border border-gray-200 bg-gray-50 text-gray-400 placeholder-gray-300 text-base cursor-not-allowed"
                                />
                            </div>
                        </div>

                        <button
                            disabled
                            className="w-full py-3 rounded-xl text-base font-bold tracking-wide bg-gray-300 text-gray-500 cursor-not-allowed"
                        >
                            Send OTP
                        </button>
                        <p className="text-sm text-gray-400 mt-2 text-center">
                            Phone verification is temporarily unavailable
                        </p>
                    </div>
                ) : step === "phone" ? (
                    /* Phone Number Step */
                    <div className="space-y-4">
                        <p className="text-sm text-dark/60">
                            We'll send a one-time code to verify your number.
                        </p>
                        <div>
                            <label className="block text-sm font-medium text-dark/70 mb-1">Phone Number</label>
                            <div className="flex gap-2">
                                <span className="flex items-center px-3 py-3 rounded-lg border border-primary/30 bg-gray-50 text-dark text-base font-medium">
                                    +91
                                </span>
                                <input
                                    type="tel"
                                    placeholder="9876543210"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    maxLength={10}
                                    className="flex-1 px-4 py-3 rounded-lg border border-primary/30 bg-white text-dark placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all text-base"
                                    autoFocus
                                />
                            </div>
                        </div>

                        {error && (
                            <p className="text-xs text-red-500">{error}</p>
                        )}

                        <button
                            onClick={handleSendOtp}
                            disabled={!isPhoneValid || loading}
                            className={`w-full py-3 rounded-xl text-base font-bold tracking-wide shadow-lg transition-all ${
                                isPhoneValid && !loading
                                    ? "bg-dark hover:bg-[#2c2323] text-white hover:shadow-xl hover:-translate-y-0.5"
                                    : "bg-gray-300 text-gray-500 cursor-not-allowed"
                            }`}
                        >
                            {loading ? "Sending..." : "Send OTP"}
                        </button>
                    </div>
                ) : (
                    /* OTP Step */
                    <div className="space-y-4">
                        <p className="text-sm text-dark/60">
                            Enter the 6-digit code sent to <span className="font-bold text-dark">+91 {phoneDigits.slice(-10)}</span>
                        </p>
                        <div>
                            <label className="block text-sm font-medium text-dark/70 mb-1">OTP Code</label>
                            <input
                                ref={otpInputRef}
                                type="text"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                placeholder="• • • • • •"
                                value={otp}
                                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                                maxLength={6}
                                className="w-full px-4 py-3 rounded-lg border border-primary/30 bg-white text-dark placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all text-base text-center tracking-[0.5em] font-mono text-lg"
                            />
                        </div>

                        {error && (
                            <p className="text-xs text-red-500">{error}</p>
                        )}

                        <button
                            onClick={handleVerifyOtp}
                            disabled={!isOtpValid || loading}
                            className={`w-full py-3 rounded-xl text-base font-bold tracking-wide shadow-lg transition-all ${
                                isOtpValid && !loading
                                    ? "bg-dark hover:bg-[#2c2323] text-white hover:shadow-xl hover:-translate-y-0.5"
                                    : "bg-gray-300 text-gray-500 cursor-not-allowed"
                            }`}
                        >
                            {loading ? "Verifying..." : "Verify OTP"}
                        </button>

                        <button
                            onClick={() => { setStep("phone"); setOtp(""); setError(""); }}
                            className="w-full text-center text-xs text-gray-400 hover:text-dark transition-colors font-medium uppercase tracking-wide"
                        >
                            Change phone number
                        </button>
                    </div>
                )}

                {/* Invisible reCAPTCHA container — no visual impact */}
                <div id="recaptcha-container" />
            </div>
        </div>
    );
}
