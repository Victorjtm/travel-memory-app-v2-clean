import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable()
export class NgrokInterceptor implements HttpInterceptor {
  
  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Si la petición es hacia una URL de ngrok, agregar headers necesarios
    if (req.url.includes('ngrok-free.app') || req.url.includes('ngrok.io')) {
      console.log('🔧 [NgrokInterceptor] Agregando headers para ngrok:', req.url);
      
      const modifiedReq = req.clone({
        setHeaders: {
          'ngrok-skip-browser-warning': '1',
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      
      return next.handle(modifiedReq);
    }
    
    // Para peticiones normales, no modificar nada
    return next.handle(req);
  }
}