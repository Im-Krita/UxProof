import type { AuditConfig, Scenario, StepType, Viewport } from './types';
export const DEFAULT_VIEWPORTS: Viewport[] = [
  {id:'desktop',label:'Desktop',width:1440,height:900},
  {id:'tablet',label:'Tablet',width:768,height:1024},
  {id:'mobile',label:'Mobile',width:390,height:844}
];
export const STEP_LABELS: Record<StepType,string> = {
  click:'Нажать',fill:'Ввести',select:'Выбрать',check:'Отметить',navigate:'Открыть URL',
  expectVisible:'Ожидать элемент',expectHidden:'Ожидать скрытие',expectText:'Проверить текст',
  expectValue:'Проверить значение',wait:'Подождать'
};
const step=(type:StepType,name:string,target='',value=''): {type:StepType;name:string;target:string;value:string} => ({type,name,target,value});
export const DEMO_SCENARIOS:Scenario[]=[
  {id:'server',title:'Выбор и подключение сервера',description:'Проверка основного сценария подключения',steps:[
    step('click','Открыть список серверов','role:button|Серверы'),
    step('select','Выбрать EU West','css:#server-select','eu-west'),
    step('click','Подключиться','role:button|Подключиться'),
    step('expectText','Убедиться в подключении','css:#connection-state','Подключено')
  ]},
  {id:'settings',title:'Сохранение настроек',description:'Проверяет, есть ли подтверждение результата',steps:[
    step('click','Открыть настройки','role:button|Настройки'),
    step('check','Включить уведомления','css:#notifications'),
    step('click','Сохранить изменения','role:button|Сохранить'),
    step('expectVisible','Увидеть подтверждение сохранения','css:[role="status"]')
  ]},
  {id:'navigation',title:'Возврат на главную',description:'Проверяет навигацию на всех размерах',steps:[
    step('click','Открыть настройки','role:button|Настройки'),
    step('click','Вернуться на главную','role:button|На главную'),
    step('expectVisible','Главный экран появился','css:#dashboard')
  ]}
];
export const DEFAULT_CONFIG:AuditConfig={
  project:'Relay — демонстрационный аудит',baseUrl:'http://127.0.0.1:4180',
  scenarios:DEMO_SCENARIOS,viewports:DEFAULT_VIEWPORTS,options:{enableAI:false,aiProvider:'openai'}
};
