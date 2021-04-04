import * as cdk from '@aws-cdk/core'
import * as ec2 from '@aws-cdk/aws-ec2'
import * as ecs from '@aws-cdk/aws-ecs'
import * as elastiCache from '@aws-cdk/aws-elasticache'
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2'
import * as rds from '@aws-cdk/aws-rds'
import * as ssm from '@aws-cdk/aws-ssm'

export class AutomuteusAwsDeploymentStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, `vpc`, {
      cidr: `10.0.0.0/16`,
      
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'apps',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: `datastores`,
          subnetType: ec2.SubnetType.ISOLATED,
        }
      ],
    })

    const publicSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PUBLIC,
    })
    const isolatedSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.ISOLATED,
    })

    const postgresSubnetGroup = new rds.SubnetGroup(this, `rds-subnet-group`, {
      vpc,
      description: `subnetgroup for automuteus-bot-2`,
      subnetGroupName: `automuteus-bot-2-rds-subnet-group`,
      vpcSubnets: isolatedSubnets,
    })

    const albSecurityGroup = new ec2.SecurityGroup(this, `alb-security-group`, {
      vpc,
      allowAllOutbound: false,
      securityGroupName: `automuteus-bot-2-alb-security-group`
    })

    const appSecurityGroup = new ec2.SecurityGroup(this, `app-security-group`, {
      vpc,
      allowAllOutbound: true,
      securityGroupName: `automuteus-bot-2-app-security-group`
    })

    const datastoreSecurityGroup = new ec2.SecurityGroup(this, `datastore-security-group`, {
      vpc,
      allowAllOutbound: false,
      securityGroupName: `automuteus-bot-2-datastore-security-group`,
    })

    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80))
    albSecurityGroup.addIngressRule(appSecurityGroup, ec2.Port.allTraffic())

    albSecurityGroup.addEgressRule(appSecurityGroup, ec2.Port.allTraffic())
    appSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.allTraffic())

    datastoreSecurityGroup.addIngressRule(appSecurityGroup, ec2.Port.tcp(6379))
    datastoreSecurityGroup.addIngressRule(appSecurityGroup, ec2.Port.tcp(5432))
    // datastoreSecurityGroup.addIngressRule(appSecurityGroup, ec2.Port.allTraffic())

    const postgresCredentials = rds.Credentials.fromPassword(`automuteus`, new cdk.SecretValue(`password`))
    const postgresCluster = new rds.ServerlessCluster(this, `postgres`, {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_10_14,
      }),
      defaultDatabaseName: `automuteus`,
      credentials: postgresCredentials,
      backupRetention: cdk.Duration.days(35),
      clusterIdentifier: `automuteus-bot-2-postgres`,
      vpc: vpc,
      deletionProtection: false,
      subnetGroup: postgresSubnetGroup,
      securityGroups: [datastoreSecurityGroup],
      scaling: {
        autoPause: cdk.Duration.minutes(5),
        minCapacity: rds.AuroraCapacityUnit.ACU_2,
        maxCapacity: rds.AuroraCapacityUnit.ACU_4,
      },
    })

    return;
    const elastiCacheSubnetGroup = new elastiCache.CfnSubnetGroup(this, `elasticache-subnet-group`, {
      description: `Subnet group for automuteus-bot-2-redis`,
      subnetIds: isolatedSubnets.subnetIds,
      cacheSubnetGroupName: `automuteus-bot-2-elasticache-subnet-group`,
    })

    const redisCluster = new elastiCache.CfnCacheCluster(this, `redis`, {
      clusterName: `automuteus-bot-2-redis`,
      cacheNodeType: `cache.t3.micro`,
      engine: `redis`,
      numCacheNodes: 1,
      cacheSubnetGroupName: elastiCacheSubnetGroup.cacheSubnetGroupName,
      vpcSecurityGroupIds: [datastoreSecurityGroup.securityGroupId]
    })
    redisCluster.addDependsOn(elastiCacheSubnetGroup)

    const discordBotTokenParameter = ssm.StringParameter.fromSecureStringParameterAttributes(
      this,
      `automuteus-bot-2-ssm-parameter-discord-bot-token`,
      {
        parameterName: '/automuteus-bot-1/discord_bot_token',
        version: 1,
      }
    )

    const galactusTaskDefinition = new ecs.FargateTaskDefinition(this, `task-def-galactus`, {
      memoryLimitMiB: 512,
      cpu: 256,
    })
    const galactusTaskDefContainer = galactusTaskDefinition.addContainer(`automuteus-bot-2-task-def-container-galactus`, {
      image: ecs.ContainerImage.fromRegistry(`automuteus/galactus:sha-e14a01e`),
      portMappings: [
        { containerPort: 8080, hostPort: 8080 },
        { containerPort: 5858 },
      ],
      environment: {
        'BROKER_PORT': `8080`,
        'GALACTUS_PORT': `5858`,
        'REDIS_ADDR': `${redisCluster.attrRedisEndpointAddress}:${redisCluster.attrRedisEndpointPort}`
      },
      secrets: {
        'DISCORD_BOT_TOKEN': ecs.Secret.fromSsmParameter(discordBotTokenParameter),
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: `automuteus-bot-2-galactus` })
    })

    const fargateCluster = new ecs.Cluster(this, `cluster`, {
      vpc,
    })

    const galactusService = new ecs.FargateService(this, `service-galactus`, {
      cluster: fargateCluster,
      serviceName: `galactus`,
      taskDefinition: galactusTaskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
      securityGroups: [appSecurityGroup],
      vpcSubnets: publicSubnets,
    })

    const alb = new elbv2.ApplicationLoadBalancer(this, 'automuteus-bot-2-load-balancer', {
      vpc,
      // ipAddressType: elbv2.IpAddressType.DUAL_STACK,
      vpcSubnets: publicSubnets,
      internetFacing: true,
      securityGroup: albSecurityGroup,
    })

    const automuteusTaskDefinition = new ecs.FargateTaskDefinition(this, `task-def-automuteus`, {
      memoryLimitMiB: 512,
      cpu: 256,
    })
    const automuteusTaskDefContainer = automuteusTaskDefinition.addContainer(`automuteus-bot-2-task-def-container-automuteus`, {
      image: ecs.ContainerImage.fromRegistry(`denverquane/amongusdiscord:sha-664a72e`),
      portMappings: [
        { containerPort: 5000 },
      ],
      environment: {
        'GALACTUS_ADDR': `http://${alb.loadBalancerDnsName}:5858`,
        'HOST': `http://${alb.loadBalancerDnsName}`,
        'POSTGRES_ADDR': `${postgresCluster.clusterEndpoint.hostname}:5432`,
        'REDIS_ADDR': `${redisCluster.attrRedisEndpointAddress}:${redisCluster.attrRedisEndpointPort}`,
        'POSTGRES_USER': `automuteus`,
        'POSTGRES_PASS': `password`,
        'BOT_LANG': `ja`,
        'AUTOMUTEUS_GLOBAL_PREFIX': `/au`,
        'AUTOMUTEUS_OFFICIAL': ``,
      },
      secrets: {
        'DISCORD_BOT_TOKEN': ecs.Secret.fromSsmParameter(discordBotTokenParameter),
      },
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: `automuteus-bot-2-automuteus` })
    })

    const automuteusService = new ecs.FargateService(this, `service-automuteus`, {
      cluster: fargateCluster,
      serviceName: `automuteus`,
      taskDefinition: automuteusTaskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
      securityGroups: [appSecurityGroup],
      vpcSubnets: publicSubnets,
    })

    const internalListener = alb.addListener(`automuteus-bot-2-alblistener-private`, {
      port: 5858,
      open: true,
      protocol: elbv2.ApplicationProtocol.HTTP,
    })
    galactusService.registerLoadBalancerTargets({
      containerName: galactusTaskDefContainer.containerName,
      containerPort: 5858,
      newTargetGroupId: `automuteus-bot-2-galactus-internal-target`,
      listener: ecs.ListenerConfig.applicationListener(internalListener, {
        protocol: elbv2.ApplicationProtocol.HTTP,
      }),
    })
    const publicListener = alb.addListener(`automuteus-bot-2-alblistener-public`, {
      port: 80,
      open: true,
      protocol: elbv2.ApplicationProtocol.HTTP,
    })
    galactusService.registerLoadBalancerTargets({
      containerName: galactusTaskDefContainer.containerName,
      containerPort: 8080,
      newTargetGroupId: `automuteus-bot-2-galactus-target`,
      listener: ecs.ListenerConfig.applicationListener(publicListener, {
        protocol: elbv2.ApplicationProtocol.HTTP,
      }),
    })
  }
}
