import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        deep: "#1d2b23",
        sage: "#4c6a63",
        orange: "#ee8e32",
        moss: "#3f7a5c",
        ink: "#16241d",
        "ink-2": "#3d5249",
        "ink-3": "#6b8177",
      },
    },
  },
  plugins: [],
} satisfies Config;
