import { environment } from '../../environments/environment';
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface HealthActivity {
  id: number;
  itinerary_id: number;
  activity_id?: number;
  date_walk: string;
  user_name: string;
  distance_km: number;
  duration_total: string;
  calories_active: number;
  calories_total: number;
  steps: number;
  pace_avg: string;
  pace_max: string;
  cadence_avg: number;
  cadence_max: number;
  stride_avg_cm: number;
  stride_max_cm: number;
  hr_avg: number;
  hr_max: number;
  zone_light: string;
  zone_intensive: string;
  zone_aerobic: string;
  zone_anaerobic: string;
  zone_vo2max: string;
  vitality_score: number;
  created_at: string;
  viaje_nombre?: string;
  actividad_nombre?: string;
  actividad_distancia_gps?: number;
  splits?: HealthSplit[];
}

export interface HealthSplit {
  id?: number;
  health_activity_id?: number;
  km_number: number;
  pace: string;
}

export interface BodyMetric {
  id: number;
  user_id: number;
  measurement_date: string;
  weight_kg: number;
  bmi: number;
  body_fat_pct: number;
  fat_mass_kg: number;
  skeletal_muscle_pct: number;
  muscle_pct: number;
  muscle_mass_kg: number;
  water_pct: number;
  water_mass_kg: number;
  visceral_fat: number;
  bone_mass_kg: number;
  bmr_kcal: number;
  protein_pct: number;
  obesity_degree_pct: number;
  metabolic_age: number;
  fat_free_weight_kg: number;
  real_age: number;
  height_cm: number;
  created_at: string;
}

@Injectable({
  providedIn: 'root'
})
export class SaludService {
  private get apiUrl(): string {
    return `${environment.apiUrl}/api/health`;
  }

  constructor(private http: HttpClient) {}

  uploadWatch(itineraryId: number, activityId: number | null, files: File[], customApiKey?: string): Observable<any> {
    const formData = new FormData();
    formData.append('itinerary_id', String(itineraryId));
    if (activityId !== null && activityId !== undefined) {
      formData.append('activity_id', String(activityId));
    }
    if (customApiKey) {
      formData.append('custom_api_key', customApiKey);
    }
    files.forEach(f => formData.append('images', f));

    return this.http.post(`${this.apiUrl}/upload-watch`, formData);
  }

  uploadScale(userId: number, files: File[], customApiKey?: string): Observable<any> {
    const formData = new FormData();
    formData.append('user_id', String(userId));
    if (customApiKey) {
      formData.append('custom_api_key', customApiKey);
    }
    files.forEach(f => formData.append('images', f));

    return this.http.post(`${this.apiUrl}/upload-scale`, formData);
  }

  getActivities(itineraryId?: number): Observable<HealthActivity[]> {
    let params = new HttpParams();
    if (itineraryId) {
      params = params.set('itinerary_id', String(itineraryId));
    }
    return this.http.get<HealthActivity[]>(`${this.apiUrl}/activities`, { params });
  }

  
  getActivityByActivityId(activityId: number): Observable<{ hasData: boolean; data: HealthActivity | null }> {
    return this.http.get<{ hasData: boolean; data: HealthActivity | null }>(`${this.apiUrl}/by-activity/${activityId}`);
  }

  getActivityDetails(id: number): Observable<HealthActivity> {
    return this.http.get<HealthActivity>(`${this.apiUrl}/activities/${id}`);
  }

  getBodyMetrics(userId?: number): Observable<BodyMetric[]> {
    let params = new HttpParams();
    if (userId) {
      params = params.set('user_id', String(userId));
    }
    return this.http.get<BodyMetric[]>(`${this.apiUrl}/body-metrics`, { params });
  }

  deleteActivity(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/activities/${id}`);
  }

  deleteBodyMetric(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/body-metrics/${id}`);
  }
}
