import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TrackEditorService } from './track-editor.service';
import { GpxPoint } from './gpx-animation.service';

describe('TrackEditorService', () => {
  let service: TrackEditorService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [TrackEditorService]
    });
    service = TestBed.inject(TrackEditorService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('interpolateTimeBetweenAnchors', () => {
    it('should interpolate time linearly across inserted points based on distance', () => {
      const t1 = new Date('2025-01-01T10:00:00.000Z');
      const t2 = new Date('2025-01-01T10:00:10.000Z'); // 10 seconds later

      const anchorA = { lat: 0, lng: 0, time: t1, distAcum: 0, timeAcum: 0 } as GpxPoint;
      const anchorB = { lat: 0, lng: 20, time: t2, distAcum: 0, timeAcum: 0 } as GpxPoint; // End point

      const newPoints: GpxPoint[] = [
        anchorA,
        { lat: 0, lng: 10, distAcum: 0, timeAcum: 0 } as GpxPoint, // Halfway point
        anchorB
      ];

      service.interpolateTimeBetweenAnchors(anchorA, anchorB, newPoints);

      // The halfway point should have a time exactly halfway (10:00:05.000Z)
      const expectedTime = new Date('2025-01-01T10:00:05.000Z');
      expect(newPoints[1].time?.getTime()).toEqual(expectedTime.getTime());
      
      // Anchors should not be modified
      expect(newPoints[0].time).toEqual(t1);
      expect(newPoints[2].time).toEqual(t2);
    });

    it('should handle zero distance gracefully', () => {
      const t1 = new Date('2025-01-01T10:00:00.000Z');
      const t2 = new Date('2025-01-01T10:00:10.000Z');

      const anchorA = { lat: 0, lng: 0, time: t1, distAcum: 0, timeAcum: 0 } as GpxPoint;
      const anchorB = { lat: 0, lng: 0, time: t2, distAcum: 0, timeAcum: 0 } as GpxPoint; 

      const newPoints: GpxPoint[] = [
        anchorA,
        { lat: 0, lng: 0, distAcum: 0, timeAcum: 0 } as GpxPoint, 
        anchorB
      ];

      service.interpolateTimeBetweenAnchors(anchorA, anchorB, newPoints);

      // It should fall back to index-based ratio (1/2 = 5 seconds)
      const expectedTime = new Date('2025-01-01T10:00:05.000Z');
      expect(newPoints[1].time?.getTime()).toEqual(expectedTime.getTime());
    });
  });

  describe('replaySegments', () => {
    it('should accumulate original and append segments', () => {
      const t1 = new Date('2025-01-01T10:00:00.000Z');
      const t2 = new Date('2025-01-01T10:00:01.000Z');
      
      const segments = [
        {
          source: 'original',
          points: [{ lat: 1, lng: 1, time: t1, distAcum: 0, timeAcum: 0 } as GpxPoint]
        },
        {
          source: 'user-append',
          points: [{ lat: 2, lng: 2, time: t2, distAcum: 0, timeAcum: 0 } as GpxPoint]
        }
      ];

      const result = service.replaySegments(segments);
      expect(result.length).toBe(2);
      expect(result[0].lat).toBe(1);
      expect(result[1].lat).toBe(2);
    });

    it('should splice correctly on a valid user-insert', () => {
      const t1 = new Date('2025-01-01T10:00:00.000Z');
      const t2 = new Date('2025-01-01T10:00:10.000Z');
      const t3 = new Date('2025-01-01T10:00:20.000Z');
      const t4 = new Date('2025-01-01T10:00:30.000Z');

      const originalPoints = [
        { lat: 1, lng: 1, time: t1, distAcum: 0, timeAcum: 0 } as GpxPoint, // 0
        { lat: 2, lng: 2, time: t2, distAcum: 0, timeAcum: 0 } as GpxPoint, // 1 (Anchor A)
        { lat: 3, lng: 3, time: t3, distAcum: 0, timeAcum: 0 } as GpxPoint, // 2 (to be replaced)
        { lat: 4, lng: 4, time: t4, distAcum: 0, timeAcum: 0 } as GpxPoint  // 3 (Anchor B)
      ];

      const insertPoints = [
        { lat: 2, lng: 2, time: t2, distAcum: 0, timeAcum: 0 } as GpxPoint, // Anchor A
        { lat: 99, lng: 99, distAcum: 0, timeAcum: 0 } as GpxPoint,         // Inserted point
        { lat: 4, lng: 4, time: t4, distAcum: 0, timeAcum: 0 } as GpxPoint  // Anchor B
      ];

      const segments = [
        { source: 'original', points: originalPoints },
        { source: 'user-insert', points: insertPoints }
      ];

      const result = service.replaySegments(segments);
      
      expect(result.length).toBe(4);
      expect(result[0].lat).toBe(1);
      expect(result[1].lat).toBe(2); // A
      expect(result[2].lat).toBe(99); // Inserted point
      expect(result[3].lat).toBe(4); // B

      // Ensure time was interpolated for the inserted point
      expect(result[2].time).toBeDefined();
      expect(result[2].time?.getTime()).toBeGreaterThan(t2.getTime());
      expect(result[2].time?.getTime()).toBeLessThan(t4.getTime());
    });

    it('should ignore an insert if anchors are missing', () => {
      const originalPoints = [
        { lat: 1, lng: 1, time: new Date('2025-01-01T10:00:00.000Z'), distAcum: 0, timeAcum: 0 } as GpxPoint
      ];

      const insertPoints = [
        { lat: 9, lng: 9, time: new Date('2025-01-01T20:00:00.000Z'), distAcum: 0, timeAcum: 0 } as GpxPoint, // Fake A
        { lat: 8, lng: 8, time: new Date('2025-01-01T21:00:00.000Z'), distAcum: 0, timeAcum: 0 } as GpxPoint  // Fake B
      ];

      const segments = [
        { source: 'original', points: originalPoints },
        { source: 'user-insert', points: insertPoints }
      ];

      // Console.warn should be called, but we won't mock it to keep test simple
      const result = service.replaySegments(segments);
      
      // Should remain just the original point
      expect(result.length).toBe(1);
      expect(result[0].lat).toBe(1);
    });

    it('should support overlapping sequential inserts', () => {
      const t1 = new Date('2025-01-01T10:00:00.000Z');
      const t2 = new Date('2025-01-01T10:00:10.000Z');
      const t3 = new Date('2025-01-01T10:00:20.000Z');
      
      const original = [
        { lat: 1, lng: 1, time: t1, distAcum: 0, timeAcum: 0 } as GpxPoint,
        { lat: 2, lng: 2, time: t2, distAcum: 0, timeAcum: 0 } as GpxPoint,
        { lat: 3, lng: 3, time: t3, distAcum: 0, timeAcum: 0 } as GpxPoint
      ];

      const insert1 = [
        { lat: 1, lng: 1, time: t1, distAcum: 0, timeAcum: 0 } as GpxPoint,
        { lat: 99, lng: 99, distAcum: 0, timeAcum: 0 } as GpxPoint,
        { lat: 3, lng: 3, time: t3, distAcum: 0, timeAcum: 0 } as GpxPoint
      ];

      // Replay first insert to capture the exact interpolated timestamp generated by Haversine
      const intermediateResult = service.replaySegments([
        { source: 'original', points: original },
        { source: 'user-insert', points: insert1 }
      ]);

      const dynamicallyGeneratedAnchor = intermediateResult[1];

      const insert2 = [
        { ...dynamicallyGeneratedAnchor }, // Anchor A (the previously inserted point)
        { lat: 88, lng: 88, distAcum: 0, timeAcum: 0 } as GpxPoint,
        { ...intermediateResult[2] }  // Anchor B
      ];

      const segments = [
        { source: 'original', points: original },
        { source: 'user-insert', points: insert1 },
        { source: 'user-insert', points: insert2 }
      ];

      const finalResult = service.replaySegments(segments);

      expect(finalResult.length).toBe(4);
      expect(finalResult[0].lat).toBe(1);
      expect(finalResult[1].lat).toBe(99); // First insert remains partly
      expect(finalResult[2].lat).toBe(88); // Second insert replaced B->C
      expect(finalResult[3].lat).toBe(3);  // End
    });
  });
});
