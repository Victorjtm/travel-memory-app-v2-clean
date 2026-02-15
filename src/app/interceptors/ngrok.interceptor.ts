import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable()
export class NgrokInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {

    console.log('🔍 [NgrokInterceptor] Interceptando:', req.url);

    // 1. INTERCEPTAR LOCALHOST Y USAR LA IP DETECTADA
    const realApiUrl = (window as any).__API_URL__;

    if (realApiUrl && req.url.includes('localhost:3000')) {
      const newUrl = req.url.replace('http://localhost:3000', realApiUrl);
      console.log(`🔄 [NgrokInterceptor] localhost → ${newUrl}`);

      const clonedRequest = req.clone({
        url: newUrl
      });

      return next.handle(clonedRequest);
    }

    // 2. INTERCEPTAR NGROK (lógica original)
    const ngrokBackendUrl = (window as any).NGROK_BACKEND_URL;

    if (ngrokBackendUrl && req.url.includes('localhost')) {
      const newUrl = req.url.replace(/http:\/\/localhost:\d+/, ngrokBackendUrl);
      console.log(`🔄 [NgrokInterceptor] ngrok → ${newUrl}`);

      const clonedRequest = req.clone({
        url: newUrl
      });

      return next.handle(clonedRequest);
    }

    console.log('➡️ [NgrokInterceptor] Sin cambios');

    // 3. Si no hay cambios, continuar normal
    return next.handle(req);
  }
}
