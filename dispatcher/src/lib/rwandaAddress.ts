
export async function queryRwandaAddress(lat: number, lon: number): Promise<{
  province?: string;
  district?: string;
  sector?: string;
  cell?: string;
  village?: string;
  addressLine?: string;
  roadName?: string;
  highway?: string;
}> {
  const empty = {};
  const apiBase = import.meta.env.VITE_API_BASE ?? "http://localhost:3003/api";
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });

  try {
    const res = await fetch(`${apiBase}/arcgis/reverse-geocode?${params.toString()}`, { method: "GET" });
    if (!res.ok) return empty as ReturnType<typeof queryRwandaAddress>;
    const json = (await res.json()) as {
      addressLine?: string;
      roadName?: string;
      highway?: string;
      province?: string;
      district?: string;
      sector?: string;
      cell?: string;
      village?: string;
    };
    return {
      province: typeof json.province === "string" ? json.province : undefined,
      district: typeof json.district === "string" ? json.district : undefined,
      sector: typeof json.sector === "string" ? json.sector : undefined,
      cell: typeof json.cell === "string" ? json.cell : undefined,
      village: typeof json.village === "string" ? json.village : undefined,
      addressLine: typeof json.addressLine === "string" ? json.addressLine : undefined,
      roadName: typeof json.roadName === "string" ? json.roadName : undefined,
      highway: typeof json.highway === "string" ? json.highway : undefined,
    };
  } catch {
    return empty as ReturnType<typeof queryRwandaAddress>;
  }
}
