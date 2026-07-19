export type EditAction = 'override_mode' | 'delete_segment' | 'replace_geometry' | 'insert_geometry';

export interface TrackAnchor {
  index?: number;       // Posición en el array (Fallback posicional)
  time?: string;        // Timestamp ISO (Resolución temporal precisa)
  lat: number;          // Coordenada absoluta (Resolución espacial de seguridad)
  lng: number;
}

// ---- Append edit (Fase 2.1.a) ----------------------------------------
export interface AppendEdit {
  id?: number;
  actividadId: number;
  action: 'append';
  // puntos que se añaden al final del track (lat/lng). Timestamps se calcularán en cliente.
  newPoints: { lat: number; lng: number }[];
  createdAt?: string;
}

// ---- Standard track edit (ediciones existentes) -----------------------
export interface TrackEdit {
  id?: number;
  actividadId: number;
  action: EditAction;

  startAnchor: TrackAnchor;
  endAnchor: TrackAnchor;

  // Propiedades dinámicas aplicadas según el action
  newMode?: string;           // Para override_mode o geometrías nuevas
  estimatedSpeedKmh?: number; // Para interpolación temporal de geometrías nuevas

  // Array de geometría (Opcional, solo para replace e insert)
  syntheticPoints?: { lat: number, lng: number, order: number }[];
  injectedGeometry?: { lat: number; lng: number }[];

  createdAt?: string;
}

// ---- Unión para el pipeline de applyEdits ----------------------------
export type AnyTrackEdit = TrackEdit | AppendEdit;
