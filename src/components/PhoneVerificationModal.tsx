import { useState, useEffect, useRef } from "react";
import { sendOtp, verifyOtp } from "../utils/api";

interface PhoneVerificationModalProps {
    onVerified: (phone: string) => void;
    onClose: () => void;
}

export default function PhoneVerificationModal({ onVerified, onClose }: PhoneVerificationModalProps) {
    const [phone, setPhone] = useState("");
    const [otp, setOtp] = useState("");
    const [step, setStep] = useState<"phone" | "otp">("phone");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const otpInputRef = useRef<HTMLInputElement>(null);

    const phoneDigits = phone.replace(/\D/g, "");
    const isPhoneValid = phoneDigits.length >= 10;
    const isOtpValid = otp.replace(/\D/g, "").length === 6;

    const handleSendOtp = async () => {
        if (!isPhoneValid || loading) return;
        setLoading(true);
        setError("");

        try {
            const fullPhone = `+91${phoneDigits.slice(-10)}`;
            const result = await sendOtp(fullPhone);
            if (result.success) {
                setStep("otp");
                // Attempt WebOTP autofill on supported browsers
                tryWebOtpAutofill();
            } else {
                setError(result.error || "Failed to send OTP. Please try again.");
            }
        } catch {
            setError("Failed to send OTP. Please try again.");
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
            const result = await verifyOtp(fullPhone, otpCode);

            if (result.verified && result.verification_token) {
                // Cache verification in localStorage for 24 hours
                localStorage.setItem(
                    "orlena_phone_verification",
                    JSON.stringify({
                        phone: fullPhone,
                        verification_token: result.verification_token,
                        verified_at: Date.now(),
                        expires: Date.now() + (result.expires_in || 86400) * 1000,
                    })
                );
                onVerified(fullPhone);
            } else {
                setError(result.error || "Invalid OTP. Please try again.");
            }
        } catch {
            setError("Verification failed. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const tryWebOtpAutofill = () => {
        try {
            if ("OTPCredential" in window) {
                const ac = new AbortController();
                // Auto-abort after 60 seconds
                const timeout = setTimeout(() => ac.abort(), 60000);

                (navigator.credentials as any)
                    .get({ otp: { transport: ["sms"] }, signal: ac.signal })
                    .then((otpCredential: any) => {
                        if (otpCredential?.code) {
                            setOtp(otpCredential.code);
                        }
                    })
                    .catch(() => {
                        // WebOTP not supported or user dismissed — ignore
                    })
                    .finally(() => clearTimeout(timeout));
            }
        } catch {
            // WebOTP not available — silent fallback
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

                {step === "phone" ? (
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
            </div>
        </div>
    );
}
