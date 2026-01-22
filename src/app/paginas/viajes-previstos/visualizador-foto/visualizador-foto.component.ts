import { Component, OnInit, ElementRef, ViewChild, ViewEncapsulation, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import Viewer from 'viewerjs';

@Component({
    selector: 'app-visualizador-foto',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './visualizador-foto.component.html',
    styleUrls: ['./visualizador-foto.component.scss'],
    encapsulation: ViewEncapsulation.None
})
export class VisualizadorFotoComponent implements OnInit, AfterViewInit {

    @ViewChild('imageElement') imageElement!: ElementRef<HTMLImageElement>;

    imageUrl: string = '';
    descripcion: string = '';
    viewer: any;
    isLoading: boolean = true;

    constructor(private route: ActivatedRoute) { }

    ngOnInit(): void {
        console.log('VisualizadorFotoComponent: OnInit');
        this.route.queryParams.subscribe(params => {
            this.imageUrl = params['url'];
            this.descripcion = params['descripcion'] || '';
            console.log('VisualizadorFotoComponent: URL recibida', this.imageUrl);
        });
    }

    ngAfterViewInit(): void {
        console.log('VisualizadorFotoComponent: AfterViewInit');
        // Check if image is already cached/loaded
        if (this.imageElement && this.imageElement.nativeElement.complete && this.imageUrl) {
            console.log('VisualizadorFotoComponent: Imagen ya estaba "complete" (caché). Inicializando...');
            this.onImageLoad();
        }
    }

    onImageLoad(): void {
        console.log('VisualizadorFotoComponent: Imagen cargada. Inicializando Viewer...');
        setTimeout(() => {
            this.inicializarViewer();
            this.isLoading = false;
        }, 50);
    }

    onImageError(): void {
        console.error('VisualizadorFotoComponent: Error al cargar la imagen');
        this.isLoading = false;
    }

    inicializarViewer(): void {
        if (!this.imageElement) return;

        if (this.viewer) {
            this.viewer.destroy();
        }

        this.viewer = new Viewer(this.imageElement.nativeElement, {
            inline: false,
            navbar: false,
            title: false,
            toolbar: {
                zoomIn: 1,
                zoomOut: 1,
                oneToOne: 1,
                reset: 1,
                prev: 0,
                play: 0,
                next: 0,
                rotateLeft: 1, // 1: Always show
                rotateRight: 1, // 1: Always show
                flipHorizontal: 1,
                flipVertical: 1,
            },
            button: true,
            backdrop: true,
            transition: false,
            minZoomRatio: 0.1,
            maxZoomRatio: 5,
            hidden: () => {
                window.close();
            },
        });

        this.viewer.show();
    }

    cerrar(): void {
        window.close();
    }
}
