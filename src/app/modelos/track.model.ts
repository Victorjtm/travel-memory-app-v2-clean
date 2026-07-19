export interface TrackPoint {
  id: string;
  lat: number;
  lng: number;
  timestamp: number; // ms since epoch, monotonic
}

export interface TrackSegment {
  id: string;
  source: 'original' | 'user-append';
  order: number; // integer, determines concatenation order
  points: TrackPoint[];
}

export interface Track {
  id: string;
  name: string;
  segments: TrackSegment[]; // ordered by `order`
}
