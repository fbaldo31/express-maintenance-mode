import { NextFunction, Request, Response, RequestHandler } from 'express';

export class ExpressMaintenance<
  MaintenanceResponseBody extends Record<string, any>
> {
  private readonly url: string = '/maintenance';
  private readonly apiBasePath: string = '/api';
  private readonly accessKey?: string;
  private readonly localMaintenanceStateTTL: number = 60000;

  private readonly getExternalMaintenanceState: GetExternalMaintenanceStateFunction<MaintenanceResponseBody> | void;
  private readonly setExternalMaintenanceState: SetExternalMaintenanceStateFunction<MaintenanceResponseBody>;

  private lastStateUpdateTimestamp: Date;
  private currentServerMode: ServerMode = ServerMode.default;
  private maintenanceResponseOptions: MaintenanceResponseOptions<MaintenanceResponseBody>;

  constructor(options: ExpressMaintenanceOptions<MaintenanceResponseBody>) {
    this.url = options.url ?? this.url;
    this.apiBasePath = options.apiBasePath ?? this.apiBasePath;
    this.accessKey = options.accessKey ?? this.accessKey;
    this.localMaintenanceStateTTL =
      options.localMaintenanceStateTTL ?? this.localMaintenanceStateTTL;
    this.getExternalMaintenanceState =
      options.getExternalMaintenanceState ?? this.getExternalMaintenanceState;
    this.setExternalMaintenanceState =
      options.setExternalMaintenanceState ?? this.setExternalMaintenanceState;
    this.lastStateUpdateTimestamp = new Date();
  }

  public get middleware(): RequestHandler {
    return async (request: Request, response: Response, next: NextFunction) => {
      await this.updateLocalMaintenanceState();

      if (this.isServerInMaintenanceMode() && this.isApiRequest(request)) {
        return response
          .status(this.maintenanceResponseOptions.statusCode)
          .json(this.maintenanceResponseOptions.body);
      }

      if (this.isMaintenanceRequest(request)) {
        const { accessKey } = request.query;
        if (this.accessKey && accessKey !== this.accessKey) {
          return response
            .status(401)
            .json({ message: 'You not authorized to perform this action' });
        }

        switch (request.method) {
          case 'GET':
            return response.status(200).json({
              message: `Server in ${this.currentServerMode} mode now`
            });
          case 'POST':
            this.currentServerMode = ServerMode.maintenance;
            this.maintenanceResponseOptions =
              request.body ?? this.maintenanceResponseOptions;
            if (this.setExternalMaintenanceState) {
              await this.setExternalMaintenanceState(
                this.getLocalMaintenanceState()
              );
            }

            break;
          case 'DELETE':
            this.currentServerMode = ServerMode.default;
            if (this.setExternalMaintenanceState) {
              await this.setExternalMaintenanceState(
                this.getLocalMaintenanceState()
              );
            }

            break;
          default:
            return response.status(405).json({
              message: `${request.method} is not allowed for this endpoint`
            });
        }

        return response.status(200).json({
          message: `Server in ${this.currentServerMode} mode now`,
          maintenanceResponseOptions: this.maintenanceResponseOptions
        });
      }

      next();
    };
  }

  private async updateLocalMaintenanceState(): Promise<void> {
    if (
      this.getExternalMaintenanceState &&
      this.isItTimeToUpdateLocalMaintenanceState()
    ) {
      const externalMaintenanceState: MaintenanceState<MaintenanceResponseBody> = await this.getExternalMaintenanceState();
      if (!externalMaintenanceState) {
        return;
      }

      const {
        currentServerMode,
        maintenanceResponseOptions
      }: MaintenanceState<MaintenanceResponseBody> = externalMaintenanceState;
      this.currentServerMode = currentServerMode;
      this.maintenanceResponseOptions = maintenanceResponseOptions;
      this.lastStateUpdateTimestamp = new Date();
    }
  }

  private isItTimeToUpdateLocalMaintenanceState(): boolean {
    return (
      this.lastStateUpdateTimestamp.getTime() + this.localMaintenanceStateTTL <
      Date.now()
    );
  }

  private isServerInMaintenanceMode(): boolean {
    return this.currentServerMode === ServerMode.maintenance;
  }

  private isApiRequest(request: Request): boolean {
    return request.url.includes(this.apiBasePath);
  }

  private isMaintenanceRequest(request: Request): boolean {
    const urlRegExp = new RegExp(`${this.url}$`);
    return Boolean(urlRegExp.test(request.path));
  }

  private getLocalMaintenanceState(): MaintenanceState<MaintenanceResponseBody> {
    return {
      currentServerMode: this.currentServerMode,
      maintenanceResponseOptions: this.maintenanceResponseOptions
    };
  }
}

export type GetExternalMaintenanceStateFunction<
  MaintenanceResponseBody extends Record<string, any>
> = () =>
  | MaintenanceState<MaintenanceResponseBody>
  | Promise<MaintenanceState<MaintenanceResponseBody>>;

export type SetExternalMaintenanceStateFunction<
  MaintenanceResponseBody extends Record<string, any>
> = (
  maintenanceState: MaintenanceState<MaintenanceResponseBody>
) => void | Promise<void>;

export interface MaintenanceState<
  MaintenanceResponseBody extends Record<string, any>
> {
  currentServerMode: ServerMode;
  maintenanceResponseOptions: MaintenanceResponseOptions<MaintenanceResponseBody>;
}

export enum ServerMode {
  default = 'default',
  maintenance = 'maintenance'
}

export interface MaintenanceResponseOptions<
  MaintenanceResponseBody extends Record<string, any>
> {
  statusCode: number;
  body: MaintenanceResponseBody;
}

export interface ExpressMaintenanceOptions<
  MaintenanceResponseBody extends Record<string, any>
> {
  url?: string;
  apiBasePath?: string;
  accessKey?: string;
  localMaintenanceStateTTL?: number;
  getExternalMaintenanceState?: GetExternalMaintenanceStateFunction<MaintenanceResponseBody>;
  setExternalMaintenanceState?: SetExternalMaintenanceStateFunction<MaintenanceResponseBody>;
}
