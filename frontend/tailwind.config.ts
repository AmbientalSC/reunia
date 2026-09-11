import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        // Identidade Ambiental (ambiental.sc)
        primary: {
          DEFAULT: "var(--ambiental-blue)",
          foreground: "#FFFFFF",
        },
        secondary: {
          DEFAULT: "var(--ambiental-gray-light)",
          foreground: "var(--ambiental-text)",
        },
        accent: {
          DEFAULT: "var(--ambiental-green)",
          foreground: "#FFFFFF",
        },
        destructive: {
          DEFAULT: "hsl(0, 84%, 60%)",
          foreground: "#FFFFFF",
        },
        ambiental: {
          blue: "var(--ambiental-blue)",
          "blue-dark": "var(--ambiental-blue-dark)",
          "blue-soft": "var(--ambiental-blue-soft)",
          "blue-hover": "var(--ambiental-blue-hover)",
          green: "var(--ambiental-green)",
          "green-mid": "var(--ambiental-green-mid)",
          "green-dark": "var(--ambiental-green-dark)",
          "green-natural": "var(--ambiental-green-natural)",
          "gray-light": "var(--ambiental-gray-light)",
          "gray-mid": "var(--ambiental-gray-mid)",
          "gray-blue": "var(--ambiental-gray-blue)",
          text: "var(--ambiental-text)",
        },
        // Rebranding global: as escalas blue/green padrão passam a usar a paleta Ambiental
        blue: {
          50: "#eef3fa",
          100: "#e1e9f7",
          200: "#c5d6ef",
          300: "#9db8e0",
          400: "#5d83c4",
          500: "#2c55a5",
          600: "#164194",
          700: "#003087",
          800: "#0a2660",
          900: "#081c49",
        },
        green: {
          50: "#f4f8e7",
          100: "#e9f1cf",
          200: "#d6e4a6",
          300: "#c4d97f",
          400: "#b5d15e",
          500: "#a8c950",
          600: "#95c11f",
          700: "#9bbf3b",
          800: "#7a942e",
          900: "#5e7322",
        },
      },
      fontFamily: {
        sans: ["var(--font-poppins)", "Poppins", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "0.375rem",
      },
      fontSize: {
        'display': ['32px', { lineHeight: '1.2', fontWeight: '700' }],
        'h1': ['24px', { lineHeight: '1.3', fontWeight: '600' }],
        'h2': ['18px', { lineHeight: '1.4', fontWeight: '500' }],
        'body': ['16px', { lineHeight: '1.6', fontWeight: '400' }],
        'small': ['14px', { lineHeight: '1.5', fontWeight: '400' }],
        'caption': ['12px', { lineHeight: '1.4', fontWeight: '400' }],
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
} satisfies Config;
