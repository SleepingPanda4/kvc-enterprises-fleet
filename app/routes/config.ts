export const routeNumbers = [
  "613", "614", "617", "618", "621", "622", "625", "626", "629",
  "630", "633", "634", "637", "638", "641", "642", "645", "1127",
] as const;

export const defaultRouteColor = "#087A46";

export const routeColorPalette = [
  "#DC2626", "#EA580C", "#D97706", "#CA8A04", "#65A30D",
  "#16A34A", "#059669", "#0D9488", "#0891B2", "#0284C7",
  "#2563EB", "#4F46E5", "#7C3AED", "#9333EA", "#C026D3",
  "#DB2777", "#E11D48", "#991B1B", "#9A3412", "#854D0E",
  "#3F6212", "#166534", "#115E59", "#155E75", "#1E40AF",
  "#3730A3", "#581C87", "#86198F", "#9D174D", "#475569",
] as const;

export function routeTextColor(color: string) {
  const value = color.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 > 150 ? "#17211B" : "#FFFFFF";
}
