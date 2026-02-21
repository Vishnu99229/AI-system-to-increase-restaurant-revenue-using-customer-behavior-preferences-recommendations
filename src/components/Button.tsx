import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary";
    children: ReactNode;
    fullWidth?: boolean;
}

export function Button({
    variant = "primary",
    children,
    className = "",
    fullWidth = false,
    disabled = false,
    ...props
}: ButtonProps) {
    const baseStyles = "rounded-xl font-bold transition-all duration-200 flex justify-center items-center text-center";
    const widthStyle = fullWidth ? "w-full" : "";
    const opacityStyle = disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer";

    const variantStyles = {
        primary: "bg-[#E65C00] text-white hover:bg-[#CC5200] shadow-md hover:shadow-lg focus:ring-2 focus:ring-[#E65C00] focus:outline-none",
        secondary: "bg-white text-[#E65C00] border-2 border-[#E65C00] hover:bg-[#FFF5F0] focus:ring-2 focus:ring-[#E65C00] focus:outline-none",
    };

    return (
        <button
            className={`${baseStyles} ${widthStyle} ${opacityStyle} ${variantStyles[variant]} py-3 px-6 ${className}`}
            disabled={disabled}
            {...props}
        >
            {children}
        </button>
    );
}
