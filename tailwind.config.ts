import type { Config } from "tailwindcss"

const config = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
	],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "Segoe UI", "Arial", "sans-serif"],
        // Codes de reference, numeros de lot, codes pays : le meme trait que les
        // plaques d'identification d'une cour de conteneurs.
        mono: ["var(--font-code)", "ui-monospace", "Consolas", "monospace"],
      },
      colors: {
        // La palette Tailwind par defaut est remplacee : des centaines de classes
        // `slate-*`, `gray-*`, `blue-*`, `green-*`, `red-*`, `yellow-*` sont ecrites
        // en dur dans les ecrans. En redefinissant les echelles ici, tous suivent la
        // charte (neutres teintes marine, bleu cobalt, vert Data Genius, rouge oxyde,
        // ocre) sans toucher chaque fichier.
        slate: {
          50: "#F5F7F9", 100: "#EBEEF2", 200: "#DDE2E8", 300: "#C5CDD6", 400: "#8E9AA9",
          500: "#66737F", 600: "#4B5764", 700: "#36414D", 800: "#232C37", 900: "#141B25", 950: "#0B1018",
        },
        gray: {
          50: "#F5F7F9", 100: "#EBEEF2", 200: "#DDE2E8", 300: "#C5CDD6", 400: "#8E9AA9",
          500: "#66737F", 600: "#4B5764", 700: "#36414D", 800: "#232C37", 900: "#141B25", 950: "#0B1018",
        },
        blue: {
          50: "#EEF4FD", 100: "#DBE8FA", 200: "#BAD2F5", 300: "#8DB4EC", 400: "#5C8FE0",
          500: "#2F6BCB", 600: "#1553AF", 700: "#0F4393", 800: "#0E3678", 900: "#0D2B5E", 950: "#081A3A",
        },
        green: {
          50: "#EDF8EF", 100: "#D6F0DA", 200: "#AEE0B7", 300: "#7ACB89", 400: "#48B05C",
          500: "#2C9442", 600: "#217A35", 700: "#1B612C", 800: "#174D26", 900: "#123E20", 950: "#0A2713",
        },
        red: {
          50: "#FDF2EF", 100: "#FBE0DA", 200: "#F6C0B5", 300: "#EE9686", 400: "#E06550",
          500: "#CC4430", 600: "#B0341F", 700: "#8F2A19", 800: "#732316", 900: "#5C1D13", 950: "#3A0F09",
        },
        yellow: {
          50: "#FFF8E6", 100: "#FEEFC0", 200: "#FCDD84", 300: "#F8C847", 400: "#EFB11A",
          500: "#D49510", 600: "#AD740B", 700: "#865810", 800: "#6B4612", 900: "#583A12", 950: "#2F1E07",
        },
        amber: {
          50: "#FFF8E6", 100: "#FEEFC0", 200: "#FCDD84", 300: "#F8C847", 400: "#EFB11A",
          500: "#D49510", 600: "#AD740B", 700: "#865810", 800: "#6B4612", 900: "#583A12", 950: "#2F1E07",
        },
        // Roles de la charte : le mur nervure du menu et les couleurs d'etat.
        shell: {
          DEFAULT: "hsl(var(--shell))",
          foreground: "hsl(var(--shell-foreground))",
          muted: "hsl(var(--shell-muted))",
          line: "hsl(var(--shell-line))",
        },
        success: { DEFAULT: "hsl(var(--success))", soft: "hsl(var(--success-soft))" },
        warning: { DEFAULT: "hsl(var(--warning))", soft: "hsl(var(--warning-soft))" },
        danger: { DEFAULT: "hsl(var(--destructive))", soft: "hsl(var(--danger-soft))" },
        info: { DEFAULT: "hsl(var(--info))", soft: "hsl(var(--info-soft))" },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Sales Statistics specific colors
        sales: {
          primary: "#2F6BCB", // Blue for sales data
          secondary: "#2C9442", // Green for budget data
          accent: "#D49510", // Amber for warnings
          success: "#059669", // Green for positive trends
          warning: "#d97706", // Orange for warnings
          danger: "#dc2626", // Red for negative trends
        },
        chart: {
          blue: "#2F6BCB",
          green: "#2C9442",
          amber: "#D49510",
          red: "#CC4430",
          purple: "#137A78",
          pink: "#865810",
          indigo: "#0E3678",
          teal: "#2AA6A0",
        },
      },
      // Les angles d'un conteneur sont presque vifs. Les `rounded-xl` et
      // `rounded-2xl` ecrits en dur dans les ecrans sont ramenes dans la meme
      // famille ; `rounded-full` reste reserve aux pastilles et aux avatars.
      borderRadius: {
        sm: "2px",
        DEFAULT: "3px",
        md: "4px",
        lg: "var(--radius)",
        xl: "8px",
        "2xl": "10px",
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '128': '32rem',
      },
      // Echelle resserree : un titre de page de 1,75 rem suffit a un outil de
      // travail, et laisse la place aux chiffres de devenir le premier niveau.
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        xl: ['1.1875rem', { lineHeight: '1.625rem' }],
        '2xl': ['1.375rem', { lineHeight: '1.75rem', letterSpacing: '-0.012em' }],
        '3xl': ['1.75rem', { lineHeight: '2.125rem', letterSpacing: '-0.02em' }],
        '4xl': ['2.125rem', { lineHeight: '2.5rem', letterSpacing: '-0.025em' }],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        // Sales Statistics specific animations
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-left": {
          "0%": { opacity: "0", transform: "translateX(-20px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "slide-in-right": {
          "0%": { opacity: "0", transform: "translateX(20px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "pulse-slow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.8" },
        },
        "bounce-subtle": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-2px)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        // Sales Statistics specific animations
        "fade-in": "fade-in 0.5s ease-out",
        "slide-in-left": "slide-in-left 0.4s ease-out",
        "slide-in-right": "slide-in-right 0.4s ease-out",
        "scale-in": "scale-in 0.3s ease-out",
        "pulse-slow": "pulse-slow 2s ease-in-out infinite",
        "bounce-subtle": "bounce-subtle 0.6s ease-in-out infinite",
      },
      backdropBlur: {
        xs: '2px',
      },
      // Ombres teintees marine, courtes : un panneau pose sur du beton, pas un
      // nuage. La profondeur vient du trait de 1 px, l'ombre ne fait que l'asseoir.
      boxShadow: {
        sm: '0 1px 2px 0 rgb(11 27 56 / 0.06)',
        DEFAULT: '0 1px 3px 0 rgb(11 27 56 / 0.08), 0 1px 2px -1px rgb(11 27 56 / 0.06)',
        md: '0 3px 8px -2px rgb(11 27 56 / 0.10), 0 1px 3px -1px rgb(11 27 56 / 0.06)',
        lg: '0 8px 20px -6px rgb(11 27 56 / 0.16), 0 2px 6px -2px rgb(11 27 56 / 0.08)',
        xl: '0 16px 36px -10px rgb(11 27 56 / 0.22), 0 4px 10px -4px rgb(11 27 56 / 0.10)',
        'soft': '0 1px 3px 0 rgb(11 27 56 / 0.08), 0 1px 2px -1px rgb(11 27 56 / 0.06)',
        'medium': '0 3px 8px -2px rgb(11 27 56 / 0.10), 0 1px 3px -1px rgb(11 27 56 / 0.06)',
        'strong': '0 8px 20px -6px rgb(11 27 56 / 0.16), 0 2px 6px -2px rgb(11 27 56 / 0.08)',
      },
      transitionProperty: {
        'height': 'height',
        'spacing': 'margin, padding',
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    // Custom plugin for sales statistics utilities
    function({ addUtilities, theme }: any) {
      const newUtilities = {
        // Sales statistics specific utilities
        '.chart-container': {
          'position': 'relative',
          'width': '100%',
          'height': '100%',
        },
        '.sales-card': {
          'background': 'white',
          'border-radius': '0.5rem',
          'box-shadow': '0 1px 3px 0 rgb(11 27 56 / 0.08), 0 1px 2px -1px rgb(11 27 56 / 0.06)',
          'border': '1px solid hsl(213 20% 86%)',
          'padding': '1.5rem',
          'transition': 'box-shadow 0.15s ease-out',
        },
        '.sales-card:hover': {
          'box-shadow': '0 3px 8px -2px rgb(11 27 56 / 0.10), 0 1px 3px -1px rgb(11 27 56 / 0.06)',
        },
        '.filter-panel': {
          'background': 'white',
          'border-radius': '0.5rem',
          'box-shadow': '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
          'border': '1px solid hsl(213 20% 86%)',
          'padding': '1.5rem',
        },
        '.metric-value': {
          'font-size': '1.875rem',
          'font-weight': '700',
          'line-height': '2.25rem',
        },
        '.metric-label': {
          'font-size': '0.875rem',
          'font-weight': '500',
          'color': '#66737F',
        },
        '.positive-trend': {
          'color': '#059669',
        },
        '.negative-trend': {
          'color': '#dc2626',
        },
        '.neutral-trend': {
          'color': '#66737F',
        },
      }
      addUtilities(newUtilities)
    }
  ],
} satisfies Config

export default config

