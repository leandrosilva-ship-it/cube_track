{{/*
Nome base do release, usado como prefixo de todos os objetos.
*/}}
{{- define "cube-track.fullname" -}}
cube-track
{{- end -}}

{{- define "cube-track.chart" -}}
{{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
{{- end -}}

{{/*
Labels comuns, aplicadas a todo objeto do chart.
*/}}
{{- define "cube-track.labels" -}}
helm.sh/chart: {{ include "cube-track.chart" . }}
app.kubernetes.io/part-of: cube-track
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/*
Labels de seleção para um componente (api/worker/web/realtime/migration/backup).
Uso: {{ include "cube-track.selectorLabels" (dict "component" "api" "context" $) }}
*/}}
{{- define "cube-track.selectorLabels" -}}
app.kubernetes.io/name: cube-track
app.kubernetes.io/instance: {{ .context.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/*
Tag de imagem padrão: image.tag ou, se vazio, o appVersion do Chart.
*/}}
{{- define "cube-track.imageTag" -}}
{{- .Values.image.tag | default .Chart.AppVersion -}}
{{- end -}}

{{/*
Referência completa de imagem para um sufixo de serviço (api/worker/web).
Uso: {{ include "cube-track.image" (dict "suffix" "api" "context" $) }}
*/}}
{{- define "cube-track.image" -}}
{{ .context.Values.image.registry }}/{{ .context.Values.image.repository }}-{{ .suffix }}:{{ include "cube-track.imageTag" .context }}
{{- end -}}

{{/*
envFrom comum: ConfigMap + Secret externo.
*/}}
{{- define "cube-track.envFrom" -}}
envFrom:
  - configMapRef:
      name: {{ include "cube-track.fullname" . }}-config
  - secretRef:
      name: {{ .Values.global.secretName }}
{{- end -}}
