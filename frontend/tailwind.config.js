/** @type {import('tailwindcss').Config} */
// Config ativo do Tailwind (CommonJS — o PostCSS usa este arquivo, não o .ts).
// Mantenha sincronizado com tailwind.config.ts.
module.exports = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-poppins)', 'Poppins', 'sans-serif'],
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        primary: {
          DEFAULT: 'var(--ambiental-blue)',
          foreground: '#FFFFFF',
        },
        secondary: {
          DEFAULT: 'var(--ambiental-gray-light)',
          foreground: 'var(--ambiental-text)',
        },
        accent: {
          DEFAULT: 'var(--ambiental-green)',
          foreground: '#FFFFFF',
        },
        destructive: {
          DEFAULT: 'hsl(0, 84%, 60%)',
          foreground: '#FFFFFF',
        },
        ambiental: {
          blue: 'var(--ambiental-blue)',
          'blue-dark': 'var(--ambiental-blue-dark)',
          'blue-soft': 'var(--ambiental-blue-soft)',
          'blue-hover': 'var(--ambiental-blue-hover)',
          green: 'var(--ambiental-green)',
          'green-mid': 'var(--ambiental-green-mid)',
          'green-dark': 'var(--ambiental-green-dark)',
          'green-natural': 'var(--ambiental-green-natural)',
          'gray-light': 'var(--ambiental-gray-light)',
          'gray-mid': 'var(--ambiental-gray-mid)',
          'gray-blue': 'var(--ambiental-gray-blue)',
          text: 'var(--ambiental-text)',
        },
        // Rebranding global: as escalas blue/green padrão usam a paleta Ambiental
        blue: {
          50: '#eef3fa',
          100: '#e1e9f7',
          200: '#c5d6ef',
          300: '#9db8e0',
          400: '#5d83c4',
          500: '#2c55a5',
          600: '#164194',
          700: '#003087',
          800: '#0a2660',
          900: '#081c49',
        },
        green: {
          50: '#f4f8e7',
          100: '#e9f1cf',
          200: '#d6e4a6',
          300: '#c4d97f',
          400: '#b5d15e',
          500: '#a8c950',
          600: '#95c11f',
          700: '#9bbf3b',
          800: '#7a942e',
          900: '#5e7322',
        },
        tertiary: '#64748b',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
      },
      borderRadius: {
        DEFAULT: '0.375rem',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontSize: {
        display: ['32px', { lineHeight: '1.2', fontWeight: '700' }],
        h1: ['24px', { lineHeight: '1.3', fontWeight: '600' }],
        h2: ['18px', { lineHeight: '1.4', fontWeight: '500' }],
        body: ['16px', { lineHeight: '1.6', fontWeight: '400' }],
        small: ['14px', { lineHeight: '1.5', fontWeight: '400' }],
        caption: ['12px', { lineHeight: '1.4', fontWeight: '400' }],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
