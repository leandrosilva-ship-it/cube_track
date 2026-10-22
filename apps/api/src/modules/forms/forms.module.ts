import { Module } from '@nestjs/common';

import { WorkServicesModule } from '../work/work.module.js';
import { CaptchaService } from './application/captcha.service.js';
import { FormSubmissionService } from './application/form-submission.service.js';
import { FormsService } from './application/forms.service.js';
import { FormsController } from './presentation/forms.controller.js';
import { PublicFormsController } from './presentation/public-forms.controller.js';

/**
 * Formulários (Prompt 8, ADR 0049): construtor (campos mapeados a colunas, lógica condicional),
 * envio público (token + captcha auto-emitido) ou interno (login), criando itens no board.
 */
@Module({
  imports: [WorkServicesModule],
  controllers: [FormsController, PublicFormsController],
  providers: [FormsService, FormSubmissionService, CaptchaService],
})
export class FormsModule {}
