/** Point of interest (AED, hydrant, etc.) for map display – fetched from API */
export interface PointOfInterest {
  id: string;
  type: "AED" | "hydrant" | "first_aid";
  lat: number;
  lon: number;
  label?: string | null;
}
