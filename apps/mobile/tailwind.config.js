/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./lib/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      fontSize: {
        xs: ["13px", { lineHeight: "18px" }],
        sm: ["15px", { lineHeight: "22px" }],
        base: ["17px", { lineHeight: "26px" }],
        lg: ["19px", { lineHeight: "28px" }],
        xl: ["21px", { lineHeight: "30px" }],
        "2xl": ["25px", { lineHeight: "32px" }],
      },
      colors: {
        border: {
          DEFAULT: "#e5e5e5",
          dark: "rgba(255, 255, 255, 0.1)",
        },
        input: {
          DEFAULT: "#e5e5e5",
          dark: "rgba(255, 255, 255, 0.08)",
        },
        ring: {
          DEFAULT: "#a3a3a3",
          dark: "#525252",
        },
        background: {
          DEFAULT: "#ffffff",
          dark: "#0a0a0a",
        },
        foreground: {
          DEFAULT: "#171717",
          dark: "#fafafa",
        },
        primary: {
          DEFAULT: "#0ea5e9",
          dark: "#38bdf8",
          foreground: "#fafafa",
        },
        secondary: {
          DEFAULT: "#f5f5f5",
          dark: "#262626",
          foreground: "#262626",
          "foreground-dark": "#fafafa",
        },
        destructive: {
          DEFAULT: "#ef4444",
          foreground: "#fafafa",
        },
        muted: {
          DEFAULT: "#f5f5f5",
          dark: "#262626",
          foreground: "#737373",
          "foreground-dark": "#a3a3a3",
        },
        accent: {
          DEFAULT: "#f5f5f5",
          dark: "#262626",
          foreground: "#262626",
          "foreground-dark": "#fafafa",
        },
        popover: {
          DEFAULT: "#ffffff",
          dark: "#171717",
          foreground: "#171717",
          "foreground-dark": "#fafafa",
        },
        card: {
          DEFAULT: "#ffffff",
          dark: "#171717",
          foreground: "#171717",
          "foreground-dark": "#fafafa",
        },
        sidebar: {
          DEFAULT: "#fafafa",
          dark: "#171717",
          foreground: "#171717",
          "foreground-dark": "#fafafa",
          primary: "#0ea5e9",
          "primary-foreground": "#fafafa",
          accent: "#f0f0f0",
          "accent-dark": "#262626",
          "accent-foreground": "#262626",
          "accent-foreground-dark": "#fafafa",
          border: "#e5e5e5",
          "border-dark": "rgba(255, 255, 255, 0.1)",
        },
      },
      borderRadius: {
        lg: "0.65rem",
        md: "0.5rem",
        sm: "0.35rem",
      },
    },
  },
  plugins: [],
};
