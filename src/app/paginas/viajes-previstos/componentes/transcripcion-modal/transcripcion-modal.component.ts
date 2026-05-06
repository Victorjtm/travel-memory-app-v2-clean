import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-transcripcion-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './transcripcion-modal.component.html',
  styleUrls: ['./transcripcion-modal.component.scss']
})
export class TranscripcionModalComponent implements OnInit {
  @Input() transcription: string = '';
  @Input() currentDescription: string = '';
  @Output() save = new EventEmitter<string>();
  @Output() cancel = new EventEmitter<void>();

  editedText: string = '';
  
  ngOnInit() {
    this.editedText = this.transcription;
  }

  onSave() {
    this.save.emit(this.editedText);
  }

  onCancel() {
    this.cancel.emit();
  }

  replace() {
    this.editedText = this.transcription;
  }

  append() {
    this.editedText = (this.currentDescription ? this.currentDescription + '\n' : '') + this.transcription;
  }

  prepend() {
    this.editedText = this.transcription + (this.currentDescription ? '\n' + this.currentDescription : '');
  }
}
