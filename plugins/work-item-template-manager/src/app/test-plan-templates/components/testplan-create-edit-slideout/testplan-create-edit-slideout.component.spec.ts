import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NimbleDrawerDirective } from '@ni/nimble-angular';
import { Subject } from 'rxjs';
import { WorkItemType } from '../../../core/constants/workitem-types.constant';
import { ICreateWorkitemTemplatesResponse } from '../../../core/models/workitem-templates.models';
import { TestplanTemplateService } from '../../services/testplan-template/testplan-template.service';
import { TestplanTemplatesModule } from '../../test-plan-templates.module';
import { TestplanCreateEditSlideoutComponent } from './testplan-create-edit-slideout.component';

describe('create/edit drawer request lifetime', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestplanTemplatesModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('does not close a reopened drawer or reset its saving state for an old save', fakeAsync(() => {
    const fixture = TestBed.createComponent(TestplanCreateEditSlideoutComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const drawer = fixture.debugElement
      .query(By.directive(NimbleDrawerDirective))
      .injector.get(NimbleDrawerDirective);
    spyOn(drawer, 'show').and.stub();
    const close = spyOn(drawer, 'close').and.stub();
    const first = new Subject<ICreateWorkitemTemplatesResponse>();
    const second = new Subject<ICreateWorkitemTemplatesResponse>();
    const save = spyOn(TestBed.inject(TestplanTemplateService), 'createTemplate').and.returnValues(
      first,
      second,
    );

    component.openPanel('create');
    component.form.controls.templateDetails.patchValue(
      {
        name: 'A',
        type: WorkItemType.Testplan,
        templateGroup: 'group',
        workspace: 'workspace',
      },
      { emitEvent: false },
    );
    component['onSave']();
    component['onSave']();
    expect(save).toHaveBeenCalledTimes(1);
    component['onCancel']();
    close.calls.reset();

    component.openPanel('create');
    expect(component['isSaving']()).toBeFalse();
    component.form.controls.templateDetails.patchValue(
      {
        name: 'B',
        type: WorkItemType.Testplan,
        templateGroup: 'group',
        workspace: 'workspace',
      },
      { emitEvent: false },
    );
    component['onSave']();
    first.next({});
    first.complete();
    expect(close).not.toHaveBeenCalled();
    expect(component['isSaving']()).toBeTrue();

    second.next({});
    second.complete();
    expect(close).toHaveBeenCalledTimes(1);
    expect(component['isSaving']()).toBeFalse();
    tick(5000);
  }));
});
